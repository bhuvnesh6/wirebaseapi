import crypto from 'crypto';

// Full key format: wb_live_<48 random hex chars>. Only the sha256 hash is ever stored;
// the plaintext key is shown to the user exactly once, at creation time.
export function generateApiKey() {
  const raw = crypto.randomBytes(24).toString('hex');
  const key = `wb_live_${raw}`;
  const prefix = key.slice(0, 14) + '…';
  return { key, prefix };
}

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
