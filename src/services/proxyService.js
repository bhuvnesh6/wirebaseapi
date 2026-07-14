import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Public, free, no-auth proxy lists. These are unreliable by nature (free proxies come
// and go, many are dead, slow, or logging traffic) - treat this as best-effort only.
// Swap in a paid proxy provider's API here for anything production-grade.
const SOURCES = [
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
];

const TEST_URL = 'https://api.ipify.org?format=json';
const TEST_TIMEOUT_MS = 5000;
const MAX_POOL_SIZE = 20;
const MAX_CANDIDATES_TO_TEST = 80;

let pool = []; // array of { url, lastCheckedAt, latencyMs }

async function fetchCandidates() {
  const candidates = new Set();

  for (const src of SOURCES) {
    try {
      const { data } = await axios.get(src, { timeout: 8000 });
      String(data)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l))
        .forEach((l) => candidates.add(`http://${l}`));
    } catch (err) {
      console.warn(`[proxyService] failed to fetch source ${src}:`, err.message);
    }
  }

  return Array.from(candidates).slice(0, MAX_CANDIDATES_TO_TEST);
}

async function testProxy(proxyUrl) {
  const start = Date.now();
  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    await axios.get(TEST_URL, { httpsAgent: agent, proxy: false, timeout: TEST_TIMEOUT_MS });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false };
  }
}

export async function refreshPool() {
  console.log('[proxyService] refreshing free proxy pool...');
  const candidates = await fetchCandidates();
  if (candidates.length === 0) {
    console.warn('[proxyService] no candidates fetched, keeping existing pool');
    return pool;
  }

  const results = [];
  const BATCH = 10;
  for (let i = 0; i < candidates.length && results.length < MAX_POOL_SIZE; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const tested = await Promise.all(batch.map(async (url) => ({ url, ...(await testProxy(url)) })));
    tested.filter((t) => t.ok).forEach((t) => results.push({ url: t.url, latencyMs: t.latencyMs, lastCheckedAt: new Date() }));
  }

  results.sort((a, b) => a.latencyMs - b.latencyMs);
  pool = results.slice(0, MAX_POOL_SIZE);
  console.log(`[proxyService] pool refreshed: ${pool.length} working proxies`);
  return pool;
}

export function getPool() {
  return pool;
}

export function getRandomProxy() {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)].url;
}

export function startAutoRefresh() {
  if (process.env.ENABLE_FREE_PROXIES !== 'true') {
    console.log('[proxyService] free proxy auto-refresh disabled (ENABLE_FREE_PROXIES != true)');
    return;
  }
  const minutes = Number(process.env.PROXY_REFRESH_MINUTES || 30);
  refreshPool().catch((err) => console.error('[proxyService] initial refresh failed:', err.message));
  setInterval(() => {
    refreshPool().catch((err) => console.error('[proxyService] refresh failed:', err.message));
  }, minutes * 60 * 1000);
}
