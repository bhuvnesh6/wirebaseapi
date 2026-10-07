import crypto from 'crypto';
import mongoose from 'mongoose';
import Developer from '../models/Developer.js';
import DeveloperApp from '../models/DeveloperApp.js';
import Tenant from '../models/Tenant.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import * as baileysManager from '../services/baileysManager.js';

/* ----------------------------- helpers ----------------------------- */

const isValidId = (id) => mongoose.isValidObjectId(id);

function parseWebhookUrl(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  try {
    const u = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false };
    return { ok: true, value: String(value).trim() };
  } catch (_) {
    return { ok: false };
  }
}

// Accepts "919876543210", "+91 98765-43210", or a full JID ("1203...@g.us").
function normalizeRecipient(to) {
  const raw = String(to ?? '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

// SECURITY: Baileys treats a non-http "url" as a LOCAL FILE PATH, so only http(s) is allowed.
function assertHttpUrl(url, type) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    throw new Error(`url for type "${type}" must be a valid http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`url for type "${type}" must be a valid http(s) URL`);
  }
  return parsed.toString();
}

function buildContent(body) {
  const { type = 'text', message, url, caption, filename, mimetype } = body;

  if (type === 'text') {
    if (!message) throw new Error('message is required for type "text"');
    return { text: String(message) };
  }

  const allowed = ['image', 'video', 'audio', 'document'];
  if (!allowed.includes(type)) throw new Error(`Unsupported type "${type}"`);
  if (!url) throw new Error(`url is required for type "${type}"`);

  const payload = { [type]: { url: assertHttpUrl(url, type) } };
  if (caption && type !== 'audio') payload.caption = String(caption);
  if (type === 'document') {
    payload.fileName = filename || 'file';
    payload.mimetype = mimetype || 'application/octet-stream';
  }
  if (type === 'audio' && mimetype) payload.mimetype = mimetype;
  return payload;
}

const serializeTenant = (t) => ({
  id: t._id,
  app: t.app,
  externalUserId: t.externalUserId,
  name: t.name,
  webhookUrl: t.webhookUrl || null,
  status: t.status,
});

const serializeInstance = (i) => ({
  id: i._id,
  name: i.name,
  status: i.status,
  externalUserId: i.externalUserId,
  tenantId: i.tenant,
  phoneNumber: i.phoneNumber || null,
  webhookUrl: i.webhookUrl || null,
  lastConnectedAt: i.lastConnectedAt || null,
  connected: baileysManager.isActive(String(i._id)),
});

function generateClientSecret() {
  return `firebase_app_${crypto.randomBytes(24).toString('hex')}`;
}

async function findAppInstance(req, res) {
  if (!isValidId(req.params.id)) {
    res.status(404).json({ error: 'Instance not found for this app' });
    return null;
  }
  const instance = await Instance.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!instance) {
    res.status(404).json({ error: 'Instance not found for this app' });
    return null;
  }
  return instance;
}

async function findAppTenant(req, res) {
  const tenant = await Tenant.findOne({ app: req.developerApp._id, externalUserId: req.params.externalUserId });
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return null;
  }
  return tenant;
}

async function destroyInstance(instance) {
  await baileysManager.stopInstance(String(instance._id), { wipeSession: true });
  await Message.deleteMany({ instance: instance._id });
  await Instance.deleteOne({ _id: instance._id });
}

/* ------------------------ developer accounts ------------------------ */

export async function registerDeveloper(req, res) {
  if (process.env.DEVELOPER_SIGNUP_ENABLED === 'false') {
    return res.status(403).json({ error: 'Developer sign-up is disabled' });
  }

  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await Developer.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: 'A developer account with that email already exists' });
  }

  const passwordHash = await Developer.hashPassword(String(password));
  let developer;
  try {
    developer = await Developer.create({ name: String(name).trim(), email: normalizedEmail, passwordHash, status: 'active' });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'A developer account with that email already exists' });
    throw err;
  }

  req.session.developerId = developer._id.toString();
  req.session.developerName = developer.name;

  res.status(201).json({ developer: developer.toSafeJSON() });
}

export async function loginDeveloper(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const developer = await Developer.findOne({ email: String(email).toLowerCase().trim(), status: 'active' });
  if (!developer || !(await developer.comparePassword(String(password)))) {
    return res.status(401).json({ error: 'Invalid developer email or password' });
  }

  req.session.developerId = developer._id.toString();
  req.session.developerName = developer.name;
  res.json({ developer: developer.toSafeJSON() });
}

export function meDeveloper(req, res) {
  if (!req.session?.developerId) {
    return res.status(401).json({ error: 'Not logged in as developer' });
  }
  return res.json({ developer: { id: req.session.developerId, name: req.session.developerName } });
}

export function logoutDeveloper(req, res) {
  req.session.destroy(() => {
    res.clearCookie('wirebase.sid');
    res.json({ message: 'Developer logged out' });
  });
}

export async function requireDeveloperSession(req, res, next) {
  if (!req.session?.developerId) {
    return res.status(401).json({ error: 'Developer session required' });
  }
  if (!isValidId(req.session.developerId)) {
    return res.status(401).json({ error: 'Developer session required' });
  }

  const developer = await Developer.findById(req.session.developerId);
  if (!developer || developer.status !== 'active') {
    return res.status(401).json({ error: 'Developer account is not active' });
  }

  req.developer = developer;
  next();
}

/* ----------------------------- apps ----------------------------- */

export async function createDeveloperApp(req, res) {
  const { name, webhookUrl } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const hook = parseWebhookUrl(webhookUrl);
  if (!hook.ok) return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL' });

  const clientId = `app_${crypto.randomBytes(10).toString('hex')}`;
  const clientSecret = generateClientSecret();
  const clientSecretHash = await DeveloperApp.hashClientSecret(clientSecret);

  const app = await DeveloperApp.create({
    developer: req.developer._id,
    name: String(name).trim(),
    clientId,
    clientSecretHash,
    webhookUrl: hook.value,
    status: 'active',
  });

  res.status(201).json({
    app: app.toSafeJSON(),
    clientSecret,
    note: 'Store this secret securely. It is shown once only.',
  });
}

export async function listDeveloperApps(req, res) {
  const apps = await DeveloperApp.find({ developer: req.developer._id }).sort({ createdAt: -1 });
  res.json({ apps: apps.map((app) => app.toSafeJSON()) });
}

export async function revokeDeveloperApp(req, res) {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'App not found' });
  const app = await DeveloperApp.findOne({ _id: req.params.id, developer: req.developer._id });
  if (!app) return res.status(404).json({ error: 'App not found' });

  app.status = 'revoked';
  await app.save();
  res.json({ app: app.toSafeJSON() });
}

export async function rotateDeveloperAppSecret(req, res) {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'App not found' });
  const app = await DeveloperApp.findOne({ _id: req.params.id, developer: req.developer._id });
  if (!app) return res.status(404).json({ error: 'App not found' });
  if (app.status !== 'active') return res.status(409).json({ error: 'Revoked apps cannot be rotated' });

  const clientSecret = generateClientSecret();
  app.clientSecretHash = await DeveloperApp.hashClientSecret(clientSecret);
  await app.save();

  res.json({
    app: app.toSafeJSON(),
    clientSecret,
    note: 'The previous secret no longer works. Store this one securely. It is shown once only.',
  });
}

/* ----------------------------- tenants ----------------------------- */

export async function upsertTenant(req, res) {
  const { externalUserId, name, webhookUrl } = req.body || {};
  if (!externalUserId) return res.status(400).json({ error: 'externalUserId is required' });
  const ext = String(externalUserId).trim();

  // Only touch fields that were actually sent - never wipe existing values.
  const update = {};
  const set = {};
  if (name !== undefined) set.name = String(name);
  else update.$setOnInsert = { name: ext };

  if (webhookUrl !== undefined) {
    const hook = parseWebhookUrl(webhookUrl);
    if (!hook.ok) return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL' });
    set.webhookUrl = hook.value;
  }
  if (Object.keys(set).length) update.$set = set;

  const tenant = await Tenant.findOneAndUpdate(
    { app: req.developerApp._id, externalUserId: ext },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({ tenant: serializeTenant(tenant) });
}

export async function listTenants(req, res) {
  const tenants = await Tenant.find({ app: req.developerApp._id }).sort({ createdAt: -1 });
  res.json({ tenants: tenants.map(serializeTenant) });
}

export async function getTenant(req, res) {
  const tenant = await findAppTenant(req, res);
  if (!tenant) return;
  res.json({ tenant: serializeTenant(tenant) });
}

export async function deleteTenant(req, res) {
  const tenant = await findAppTenant(req, res);
  if (!tenant) return;

  const instances = await Instance.find({ app: req.developerApp._id, tenant: tenant._id });
  for (const instance of instances) await destroyInstance(instance);
  await Tenant.deleteOne({ _id: tenant._id });

  res.json({ deleted: true, externalUserId: tenant.externalUserId, instancesRemoved: instances.length });
}

// Accepts either the tenant's Mongo id or its externalUserId.
export async function updateTenantWebhook(req, res) {
  const hook = parseWebhookUrl(req.body?.webhookUrl);
  if (!hook.ok) return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL' });

  const ref = req.params.id;
  const filter = { app: req.developerApp._id, $or: [{ externalUserId: ref }] };
  if (isValidId(ref)) filter.$or.push({ _id: ref });

  const tenant = await Tenant.findOne(filter);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  tenant.webhookUrl = hook.value;
  await tenant.save();
  res.json({ tenant: { id: tenant._id, externalUserId: tenant.externalUserId, webhookUrl: tenant.webhookUrl } });
}

/* ----------------------------- instances ----------------------------- */

export async function createTenantInstance(req, res) {
  const { externalUserId } = req.params;
  const { name, webhookUrl } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const hook = parseWebhookUrl(webhookUrl);
  if (!hook.ok) return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL' });

  const tenant = await Tenant.findOne({ app: req.developerApp._id, externalUserId });
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found. Create it first via POST /api/v1/developer/tenants' });
  }

  let instance;
  try {
    instance = await Instance.create({
      ownerRole: 'admin',
      ownerId: null,
      app: req.developerApp._id,
      tenant: tenant._id,
      externalUserId: tenant.externalUserId,
      name: String(name).trim(),
      // Only store an explicit override. Otherwise the webhook is resolved at delivery time:
      // instance -> tenant -> app, so later tenant/app webhook changes take effect immediately.
      webhookUrl: hook.value,
      webhookSecret: crypto.randomBytes(16).toString('hex'),
      status: 'created',
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'An instance with that name already exists' });
    }
    throw err;
  }

  res.status(201).json({
    instance: {
      id: instance._id,
      name: instance.name,
      status: instance.status,
      externalUserId: instance.externalUserId,
      webhookSecret: instance.webhookSecret,
    },
    note: 'Use webhookSecret to verify X-Wirebase-Signature on incoming webhooks.',
  });
}

export async function listAppInstances(req, res) {
  const filter = { app: req.developerApp._id };
  if (req.query.externalUserId) filter.externalUserId = String(req.query.externalUserId);
  const instances = await Instance.find(filter).sort({ createdAt: -1 });
  res.json({ instances: instances.map(serializeInstance) });
}

export async function listTenantInstances(req, res) {
  const tenant = await findAppTenant(req, res);
  if (!tenant) return;
  const instances = await Instance.find({ app: req.developerApp._id, tenant: tenant._id }).sort({ createdAt: -1 });
  res.json({ instances: instances.map(serializeInstance) });
}

export async function getDeveloperInstance(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  const effectiveWebhookUrl = await baileysManager.resolveWebhookUrl(instance);
  res.json({
    instance: {
      ...serializeInstance(instance),
      effectiveWebhookUrl,
      webhookSecret: instance.webhookSecret,
    },
  });
}

export async function updateInstanceWebhook(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  const hook = parseWebhookUrl(req.body?.webhookUrl);
  if (!hook.ok) return res.status(400).json({ error: 'webhookUrl must be a valid http(s) URL (or null to inherit)' });

  instance.webhookUrl = hook.value;
  await instance.save();
  const effectiveWebhookUrl = await baileysManager.resolveWebhookUrl(instance);
  res.json({ instanceId: instance._id, webhookUrl: instance.webhookUrl, effectiveWebhookUrl });
}

export async function getDeveloperInstanceStatus(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  res.json({
    instanceId: instance._id,
    externalUserId: instance.externalUserId,
    tenantId: instance.tenant,
    status: instance.status,
    phoneNumber: instance.phoneNumber,
    lastConnectedAt: instance.lastConnectedAt,
    connected: baileysManager.isActive(instance._id.toString()),
    qrCode: instance.qrCode || null,
  });
}

export async function connectDeveloperInstance(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  try {
    await baileysManager.startInstance(instance._id.toString(), req.app.get('io'));
    res.json({ message: 'Connection started', instanceId: instance._id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to connect instance' });
  }
}

export async function logoutDeveloperInstance(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  await baileysManager.stopInstance(instance._id.toString(), { wipeSession: true });
  res.json({ message: 'Instance logged out. Call /connect to pair a new device.', instanceId: instance._id });
}

export async function deleteDeveloperInstance(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  await destroyInstance(instance);
  res.json({ deleted: true, instanceId: instance._id });
}

export async function getDeveloperQR(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  let note;
  if (instance.qrCode) note = 'QR is available from the current session';
  else if (instance.status === 'connected') note = 'Instance is already connected; no QR needed.';
  else note = 'Call POST /instances/:id/connect, then poll this endpoint (or /status) until qrCode is set.';

  res.json({ instanceId: instance._id, status: instance.status, qrCode: instance.qrCode || null, note });
}

/* ----------------------------- messages ----------------------------- */

export async function listDeveloperMessages(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const filter = { instance: instance._id };
  if (req.query.number) filter.number = String(req.query.number).replace(/\D/g, '');
  if (['in', 'out'].includes(req.query.direction)) filter.direction = req.query.direction;
  if (req.query.before) {
    const d = new Date(String(req.query.before));
    if (!Number.isNaN(d.getTime())) filter.createdAt = { $lt: d };
  }

  const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(limit);
  res.json({ messages });
}

export async function sendDeveloperMessage(req, res) {
  const instance = await findAppInstance(req, res);
  if (!instance) return;

  const to = normalizeRecipient(req.body?.to);
  if (!to) return res.status(400).json({ error: '"to" is required (phone number with country code, or a full JID)' });

  if (!baileysManager.isActive(instance._id.toString()) || instance.status !== 'connected') {
    return res.status(409).json({ error: 'Instance is not connected. Call POST /instances/:id/connect first.' });
  }

  let content;
  try {
    content = buildContent(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let result;
  try {
    result = await baileysManager.sendContent(instance._id.toString(), to, content);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to send message' });
  }

  // The message is already sent at this point - never report failure because logging failed.
  try {
    await Message.create({
      instance: instance._id,
      direction: 'out',
      number: to.split('@')[0],
      isGroup: to.endsWith('@g.us'),
      groupId: to.endsWith('@g.us') ? to.split('@')[0] : null,
      message: req.body.message || req.body.caption || `[${req.body.type || 'text'}]`,
      messageId: result?.key?.id || null,
      waTimestamp: new Date(),
    });
  } catch (err) {
    console.error('[developerController] failed to log outbound message:', err.message);
  }

  res.json({ success: true, instanceId: instance._id, messageId: result?.key?.id || null });
}