import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import makeWASocket, { Browsers, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from 'baileys';
import { Boom } from '@hapi/boom';
import axios from 'axios';
import QRCode from 'qrcode';
import chalk from 'chalk';
import P from 'pino';
import { HttpsProxyAgent } from 'https-proxy-agent';

import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import Tenant from '../models/Tenant.js';
import DeveloperApp from '../models/DeveloperApp.js';
import { getRandomProxy } from './proxyService.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SESSIONS_DIR = path.resolve(process.cwd(), process.env.SESSIONS_DIR || './sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const logger = P({ level: 'silent' });

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const WEBHOOK_RETRIES = 2; // + the first attempt = 3 total

// live in-memory registry: instanceId -> { sock, io, keepAliveInterval }
const active = new Map();
// instanceId -> Promise, prevents two concurrent /connect calls from opening two sockets
const starting = new Map();

function room(instanceId) {
  return `instance:${instanceId}`;
}

// Event handlers must never throw: an unhandled rejection here would take the whole process down.
const safe = (label, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.error(chalk.red(`[baileysManager] ${label} failed:`), err);
  }
};

function extractMessageText(message) {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId)
    return message.listResponseMessage.singleSelectReply.selectedRowId;
  return null;
}

// WhatsApp increasingly sends messages with a "LID" (Linked ID) instead of the real phone
// number, e.g. remoteJid "259910650560760@lid" instead of "919876543210@s.whatsapp.net" -
// this is a privacy feature on WhatsApp's side, not a bug. Baileys exposes the real
// phone-number JID (when it knows it) via remoteJidAlt (DMs) / participantAlt (groups) on the
// message key. If that's missing, we fall back to Baileys' own LID<->PN mapping store. Some
// LIDs genuinely have no known phone-number mapping yet (WhatsApp only reveals it on demand,
// e.g. via a business's { requestPhoneNumber: true } message) - in that case we return the LID
// itself with isLid: true so callers/webhooks can tell the difference.
async function resolveSender(msg, isGroup, sock) {
  let jid = isGroup ? msg.key.participant || msg.key.remoteJid : msg.key.remoteJid;
  const altJid = isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt;

  if (jid?.endsWith('@lid') && altJid) {
    jid = altJid;
  }

  if (jid?.endsWith('@lid')) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) jid = pn;
    } catch (_) {
      // no known mapping yet - fall through with the LID as-is
    }
  }

  const isLid = !!jid?.endsWith('@lid');
  return { number: (jid || '').split('@')[0], isLid };
}

/* ------------------------------ webhooks ------------------------------ */

// Webhook URL priority: instance override -> tenant -> developer app.
// Resolved at delivery time, so changing a tenant/app webhook applies to existing instances.
export async function resolveWebhookUrl(instanceDoc) {
  if (instanceDoc.webhookUrl) return instanceDoc.webhookUrl;
  if (instanceDoc.tenant) {
    const tenant = await Tenant.findById(instanceDoc.tenant).select('webhookUrl').lean();
    if (tenant?.webhookUrl) return tenant.webhookUrl;
  }
  if (instanceDoc.app) {
    const app = await DeveloperApp.findById(instanceDoc.app).select('webhookUrl').lean();
    if (app?.webhookUrl) return app.webhookUrl;
  }
  return null;
}

// Signed delivery: X-Wirebase-Signature = "sha256=" + HMAC_SHA256(webhookSecret, `${timestamp}.${rawBody}`)
// Returns { delivered, attempts }.
async function postToWebhook(instanceDoc, event, payload) {
  const url = await resolveWebhookUrl(instanceDoc);
  if (!url) return { delivered: false, attempts: 0 };

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = instanceDoc.webhookSecret || '';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-Wirebase-Event': event,
    'X-Wirebase-Timestamp': timestamp,
    'X-Wirebase-Signature': `sha256=${signature}`,
    'X-Webhook-Secret': secret, // legacy header, kept for existing integrations
  };

  for (let attempt = 0; attempt <= WEBHOOK_RETRIES; attempt++) {
    try {
      await axios.post(url, body, { headers, timeout: 10_000, maxRedirects: 0 });
      return { delivered: true, attempts: attempt + 1 };
    } catch (err) {
      console.error(
        chalk.red(`[webhook] delivery failed for instance ${instanceDoc._id} (attempt ${attempt + 1}):`),
        err.message
      );
      if (attempt < WEBHOOK_RETRIES) await wait(1000 * 2 ** attempt);
    }
  }
  return { delivered: false, attempts: WEBHOOK_RETRIES + 1 };
}

// instance.status events - only for developer-app instances (admin/sub-admin webhooks are unchanged).
function notifyStatus(instanceId, status, extra = {}) {
  (async () => {
    const doc = await Instance.findById(instanceId);
    if (!doc?.app) return;
    await postToWebhook(doc, 'instance.status', {
      event: 'instance.status',
      instanceId: String(instanceId),
      appId: doc.app,
      tenantId: doc.tenant || null,
      externalUserId: doc.externalUserId || null,
      status,
      ...extra,
      timestamp: new Date().toISOString(),
    });
  })().catch((err) => console.error(chalk.red(`[webhook] status notify failed for ${instanceId}:`), err.message));
}

async function updateStatus(instanceId, io, status, extra = {}) {
  await Instance.findByIdAndUpdate(instanceId, { status, ...extra });
  io.to(room(instanceId)).emit('status', { instanceId, status, ...extra });
}

// Periodically pings WhatsApp's servers over the existing socket so idle connections
// aren't silently dropped by network middleboxes/load balancers during long quiet periods.
// This does NOT replace Baileys' own reconnect logic - it just keeps a healthy socket busy.
function startKeepAlive(instanceId, sock) {
  const keepAliveInterval = setInterval(async () => {
    if (!active.has(instanceId)) {
      clearInterval(keepAliveInterval);
      return;
    }
    try {
      await sock.query({
        tag: 'iq',
        attrs: { type: 'get', xmlns: 'urn:xmpp:ping', id: `keep-alive-${Date.now()}` },
      });
      console.log(chalk.blue(`[keep-alive] ping sent for instance ${instanceId}`));
    } catch (err) {
      console.warn(chalk.yellow(`[keep-alive] ping failed for ${instanceId}: ${err.message}`));
    }
  }, KEEP_ALIVE_INTERVAL);

  return keepAliveInterval;
}

/* ------------------------------ lifecycle ------------------------------ */

export function startInstance(instanceId, io) {
  if (active.has(instanceId)) return Promise.resolve(active.get(instanceId).sock);
  if (starting.has(instanceId)) return starting.get(instanceId);

  const promise = bootSocket(instanceId, io).finally(() => starting.delete(instanceId));
  starting.set(instanceId, promise);
  return promise;
}

async function bootSocket(instanceId, io) {
  const instanceDoc = await Instance.findById(instanceId);
  if (!instanceDoc) throw new Error('Instance not found');

  const sessionPath = path.join(SESSIONS_DIR, instanceId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const socketOptions = {
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  };

  // best-effort free-proxy support for Baileys' outgoing HTTP calls (media upload/download, etc)
  if (instanceDoc.useProxy) {
    const proxyUrl = instanceDoc.proxyUrl || getRandomProxy();
    if (proxyUrl) {
      socketOptions.agent = new HttpsProxyAgent(proxyUrl);
      socketOptions.fetchAgent = new HttpsProxyAgent(proxyUrl);
      if (proxyUrl !== instanceDoc.proxyUrl) await Instance.findByIdAndUpdate(instanceId, { proxyUrl });
    } else {
      console.warn(chalk.yellow(`[baileysManager] useProxy set for ${instanceId} but no working proxy is available`));
    }
  }

  const sock = makeWASocket(socketOptions);
  const keepAliveInterval = startKeepAlive(instanceId, sock);
  active.set(instanceId, { sock, io, keepAliveInterval });

  sock.ev.on(
    'connection.update',
    safe(`connection.update ${instanceId}`, async (update) => {
      // Ignore events from a socket that was stopped/replaced (manual stop, logout, restart).
      const entry = active.get(instanceId);
      if (!entry || entry.sock !== sock) return;

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr);
        await Instance.findByIdAndUpdate(instanceId, { status: 'qr_pending', qrCode: qrDataUrl });
        io.to(room(instanceId)).emit('qr', { instanceId, qr: qrDataUrl });
      }

      if (connection === 'connecting') {
        await updateStatus(instanceId, io, 'connecting');
      }

      if (connection === 'open') {
        const meNumber = sock.user?.id?.split(':')[0] || null;
        const mePushName = sock.user?.name || null;
        await Instance.findByIdAndUpdate(instanceId, {
          status: 'connected',
          qrCode: null,
          phoneNumber: meNumber,
          pushName: mePushName,
          lastConnectedAt: new Date(),
          lastDisconnectReason: null,
        });
        io.to(room(instanceId)).emit('status', { instanceId, status: 'connected', phoneNumber: meNumber, pushName: mePushName });
        notifyStatus(instanceId, 'connected', { phoneNumber: meNumber });
        console.log(chalk.green(`✅ Instance ${instanceId} connected as ${meNumber}`));
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : undefined;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const reason = lastDisconnect?.error?.message || 'unknown';

        if (entry.keepAliveInterval) clearInterval(entry.keepAliveInterval);
        active.delete(instanceId);

        if (loggedOut) {
          await Instance.findByIdAndUpdate(instanceId, { status: 'logged_out', qrCode: null, lastDisconnectReason: reason });
          io.to(room(instanceId)).emit('status', { instanceId, status: 'logged_out', reason });
          notifyStatus(instanceId, 'logged_out', { reason });
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log(chalk.red(`⛔ Instance ${instanceId} logged out: ${reason}`));
        } else if (reason.includes('QR refs attempts ended')) {
          // Nobody scanned in time: stop looping. The next /connect call starts a fresh QR round.
          await Instance.findByIdAndUpdate(instanceId, { status: 'qr_expired', qrCode: null, lastDisconnectReason: reason });
          io.to(room(instanceId)).emit('status', { instanceId, status: 'qr_expired', reason });
          notifyStatus(instanceId, 'qr_expired', { reason });
          console.log(chalk.yellow(`⌛ Instance ${instanceId}: QR expired unscanned, waiting for a new connect request`));
        } else {
          await Instance.findByIdAndUpdate(instanceId, { status: 'disconnected', qrCode: null, lastDisconnectReason: reason });
          io.to(room(instanceId)).emit('status', { instanceId, status: 'disconnected', reason });
          notifyStatus(instanceId, 'disconnected', { reason });
          console.log(chalk.yellow(`⚠️  Instance ${instanceId} disconnected: ${reason} - reconnecting in 3s`));
          await wait(3000);
          startInstance(instanceId, io).catch((err) =>
            console.error(chalk.red(`[baileysManager] reconnect failed for ${instanceId}:`), err.message)
          );
        }
      }
    })
  );

  sock.ev.on('creds.update', safe(`creds.update ${instanceId}`, saveCreds));

  sock.ev.on(
    'messages.upsert',
    safe(`messages.upsert ${instanceId}`, async ({ messages, type }) => {
      if (type !== 'notify') return;

      const instanceNow = await Instance.findById(instanceId);
      if (!instanceNow) return;

      for (const msg of messages) {
        try {
          if (!msg.message) continue;

          const remoteJid = msg.key.remoteJid || '';
          const isGroup = remoteJid.endsWith('@g.us');
          const fromMe = !!msg.key.fromMe;

          // Skip group messages unless this instance has opted in
          if (isGroup && !instanceNow.includeGroupMessages) continue;

          // Skip our own outgoing messages unless this instance has opted in
          if (fromMe && !instanceNow.includeOwnMessages) continue;

          const senderJid = isGroup ? msg.key.participant || remoteJid : remoteJid;
          const { number, isLid } = await resolveSender(msg, isGroup, sock);
          if (isLid) {
            console.warn(
              chalk.yellow(`[baileysManager] instance ${instanceId}: no phone number mapping for LID ${senderJid} yet - using LID as-is`)
            );
          }
          const text = extractMessageText(msg.message);
          if (text === null) continue;

          const direction = fromMe ? 'out' : 'in';

          const doc = await Message.create({
            instance: instanceId,
            direction,
            number,
            isLid,
            message: text,
            isGroup,
            groupId: isGroup ? remoteJid.split('@')[0] : null,
            pushName: msg.pushName || null,
            messageId: msg.key.id,
            waTimestamp: new Date((Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000),
          });

          io.to(room(instanceId)).emit('message', {
            instanceId,
            direction,
            number,
            isLid,
            message: text,
            isGroup,
            pushName: msg.pushName || null,
            timestamp: doc.waTimestamp,
          });

          const event = fromMe ? 'message.sent' : 'message.received';

          // Fire-and-forget so a slow/failing webhook never blocks processing of the next message.
          postToWebhook(instanceNow, event, {
            event,
            instanceId,
            instanceName: instanceNow.name,
            appId: instanceNow.app || null,
            tenantId: instanceNow.tenant || null,
            externalUserId: instanceNow.externalUserId || null,
            message: {
              id: msg.key.id,
              from: isLid ? `${number}@lid` : number,
              text,
              timestamp: doc.waTimestamp,
            },
            direction,
            isLid,
            isGroup,
            groupId: isGroup ? remoteJid.split('@')[0] : null,
            pushName: msg.pushName || null,
          })
            .then(({ delivered, attempts }) =>
              Message.findByIdAndUpdate(doc._id, { webhookDelivered: delivered, webhookAttempts: attempts })
            )
            .catch((err) => console.error(chalk.red(`[webhook] bookkeeping failed for ${instanceId}:`), err.message));
        } catch (err) {
          console.error(chalk.red(`[baileysManager] error processing message for ${instanceId}:`), err);
        }
      }
    })
  );

  return sock;
}

export async function stopInstance(instanceId, { wipeSession = false, logout = true } = {}) {
  const entry = active.get(instanceId);
  if (entry) {
    // Remove from the registry FIRST so the resulting 'close' event is treated as stale (no auto-reconnect).
    active.delete(instanceId);
    if (entry.keepAliveInterval) clearInterval(entry.keepAliveInterval);

    if (logout) {
      try {
        await Promise.race([entry.sock.logout(), wait(5000)]);
      } catch (_) {
        // socket may already be dead; ignore
      }
    }
    try {
      entry.sock.end(undefined);
    } catch (_) {
      // ignore
    }
  }

  if (logout) {
    await Instance.findByIdAndUpdate(instanceId, {
      status: 'logged_out',
      qrCode: null,
      lastDisconnectReason: 'logged out by request',
    }).catch(() => {});
    if (entry?.io) entry.io.to(room(instanceId)).emit('status', { instanceId, status: 'logged_out', reason: 'logged out by request' });
    if (entry) notifyStatus(instanceId, 'logged_out', { reason: 'logged out by request' });
  }

  if (wipeSession) {
    const sessionPath = path.join(SESSIONS_DIR, instanceId);
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
}

// Called on server boot: reconnect every instance that was paired before the restart.
export async function restoreInstances(io) {
  const docs = await Instance.find({
    status: { $in: ['connected', 'connecting', 'disconnected'] },
    phoneNumber: { $ne: null },
  }).select('_id');

  console.log(chalk.cyan(`[baileysManager] restoring ${docs.length} instance(s)`));

  for (const d of docs) {
    const id = String(d._id);
    if (!fs.existsSync(path.join(SESSIONS_DIR, id, 'creds.json'))) continue;
    try {
      await startInstance(id, io);
    } catch (err) {
      console.error(chalk.red(`[baileysManager] restore failed for ${id}:`), err.message);
    }
    await wait(1000); // stagger so we don't open dozens of sockets at once
  }
}

// Called on SIGINT/SIGTERM: close sockets WITHOUT logging out so sessions survive the restart.
export function shutdownAll() {
  const entries = [...active.values()];
  active.clear(); // clear first so 'close' events are ignored (no reconnect during shutdown)
  for (const entry of entries) {
    if (entry.keepAliveInterval) clearInterval(entry.keepAliveInterval);
    try {
      entry.sock.end(undefined);
    } catch (_) {
      // ignore
    }
  }
}

function toJid(toNumber) {
  return toNumber.includes('@') ? toNumber : `${toNumber}@s.whatsapp.net`;
}

export function sendText(instanceId, toNumber, text) {
  const entry = active.get(instanceId);
  if (!entry) throw new Error('Instance is not connected');
  return entry.sock.sendMessage(toJid(toNumber), { text });
}

// Generic sender used by the public API - `content` is a Baileys message content object,
// e.g. { text }, { image: { url }, caption }, { video: { url }, caption }, { document: { url }, mimetype, fileName }.
export function sendContent(instanceId, toNumber, content) {
  const entry = active.get(instanceId);
  if (!entry) throw new Error('Instance is not connected');
  return entry.sock.sendMessage(toJid(toNumber), content);
}

export function isActive(instanceId) {
  return active.has(instanceId);
}