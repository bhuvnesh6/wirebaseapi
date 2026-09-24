import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Developer from '../models/Developer.js';
import DeveloperApp from '../models/DeveloperApp.js';
import Tenant from '../models/Tenant.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import * as baileysManager from '../services/baileysManager.js';

function pickAppScope(req) {
  return { app: req.developerApp._id };
}

function buildContent(body) {
  const { type = 'text', message, url, caption, filename, mimetype } = body;

  if (type === 'text') {
    if (!message) throw new Error('message is required for type "text"');
    return { text: message };
  }

  const allowed = ['image', 'video', 'audio', 'document'];
  if (!allowed.includes(type)) {
    throw new Error(`Unsupported type "${type}"`);
  }

  if (!url) throw new Error(`url is required for type "${type}"`);
  const payload = { [type]: { url } };
  if (caption) payload.caption = caption;
  if (type === 'document') {
    payload.fileName = filename || 'file';
    payload.mimetype = mimetype || 'application/octet-stream';
  }
  if (type === 'audio' && mimetype) payload.mimetype = mimetype;
  return payload;
}

export async function registerDeveloper(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await Developer.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: 'A developer account with that email already exists' });
  }

  const passwordHash = await Developer.hashPassword(password);
  const developer = await Developer.create({ name, email: normalizedEmail, passwordHash, status: 'active' });

  req.session.developerId = developer._id.toString();
  req.session.developerName = developer.name;

  res.status(201).json({ developer: developer.toSafeJSON() });
}

export async function loginDeveloper(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const developer = await Developer.findOne({ email: String(email).toLowerCase().trim(), status: 'active' });
  if (!developer || !(await developer.comparePassword(password))) {
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

  const developer = await Developer.findById(req.session.developerId);
  if (!developer || developer.status !== 'active') {
    return res.status(401).json({ error: 'Developer account is not active' });
  }

  req.developer = developer;
  next();
}

export async function createDeveloperApp(req, res) {
  const { name, webhookUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const clientId = `app_${crypto.randomBytes(10).toString('hex')}`;
  const clientSecret = `firebase_app_${crypto.randomBytes(24).toString('hex')}`;
  const clientSecretHash = await DeveloperApp.hashClientSecret(clientSecret);

  const app = await DeveloperApp.create({
    developer: req.developer._id,
    name,
    clientId,
    clientSecretHash,
    webhookUrl: webhookUrl || null,
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
  const app = await DeveloperApp.findOne({ _id: req.params.id, developer: req.developer._id });
  if (!app) return res.status(404).json({ error: 'App not found' });

  app.status = 'revoked';
  await app.save();
  res.json({ app: app.toSafeJSON() });
}

export async function upsertTenant(req, res) {
  const { externalUserId, name, webhookUrl } = req.body;
  if (!externalUserId) return res.status(400).json({ error: 'externalUserId is required' });

  const tenant = await Tenant.findOneAndUpdate(
    { app: req.developerApp._id, externalUserId },
    { $set: { name: name || externalUserId, webhookUrl: webhookUrl || null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({ tenant: { id: tenant._id, app: tenant.app, externalUserId: tenant.externalUserId, name: tenant.name, webhookUrl: tenant.webhookUrl, status: tenant.status } });
}

export async function listTenants(req, res) {
  const tenants = await Tenant.find({ app: req.developerApp._id }).sort({ createdAt: -1 });
  res.json({ tenants: tenants.map((tenant) => ({ id: tenant._id, externalUserId: tenant.externalUserId, name: tenant.name, webhookUrl: tenant.webhookUrl, status: tenant.status })) });
}

export async function createTenantInstance(req, res) {
  const { externalUserId } = req.params;
  const { name, webhookUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const tenant = await Tenant.findOne({ app: req.developerApp._id, externalUserId });
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found. Create it first via POST /api/v1/developer/tenants' });
  }

  const instance = await Instance.create({
    ownerRole: 'admin',
    ownerId: null,
    app: req.developerApp._id,
    tenant: tenant._id,
    externalUserId: tenant.externalUserId,
    name,
    webhookUrl: webhookUrl || tenant.webhookUrl || req.developerApp.webhookUrl || null,
    webhookSecret: crypto.randomBytes(16).toString('hex'),
    status: 'created',
  });

  res.status(201).json({ instance: { id: instance._id, name: instance.name, status: instance.status, externalUserId: instance.externalUserId } });
}

export async function listAppInstances(req, res) {
  const instances = await Instance.find({ app: req.developerApp._id }).sort({ createdAt: -1 });
  res.json({ instances: instances.map((instance) => ({ id: instance._id, name: instance.name, status: instance.status, externalUserId: instance.externalUserId, phoneNumber: instance.phoneNumber, lastConnectedAt: instance.lastConnectedAt })) });
}

export async function getDeveloperInstanceStatus(req, res) {
  const instance = await Instance.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!instance) return res.status(404).json({ error: 'Instance not found for this app' });

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
  const instance = await Instance.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!instance) return res.status(404).json({ error: 'Instance not found for this app' });

  try {
    await baileysManager.startInstance(instance._id.toString(), req.app.get('io'));
    res.json({ message: 'Connection started', instanceId: instance._id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to connect instance' });
  }
}

export async function getDeveloperQR(req, res) {
  const instance = await Instance.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!instance) return res.status(404).json({ error: 'Instance not found for this app' });

  res.json({ instanceId: instance._id, qrCode: instance.qrCode || null, note: instance.qrCode ? 'QR is available from the current session' : 'Use socket.io or connect the instance to generate a QR code.' });
}

export async function listDeveloperMessages(req, res) {
  const instance = await Instance.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!instance) return res.status(404).json({ error: 'Instance not found for this app' });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const messages = await Message.find({ instance: instance._id }).sort({ createdAt: -1 }).limit(limit);
  res.json({ messages });
}

export async function sendDeveloperMessage(req, res) {
  const instance = await Instance.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!instance) return res.status(404).json({ error: 'Instance not found for this app' });
  if (!req.body.to) return res.status(400).json({ error: 'to is required' });
  if (instance.status !== 'connected') return res.status(409).json({ error: 'Instance is not connected' });

  try {
    const content = buildContent(req.body);
    const result = await baileysManager.sendContent(instance._id.toString(), req.body.to, content);

    await Message.create({
      instance: instance._id,
      direction: 'out',
      number: req.body.to.replace('@s.whatsapp.net', ''),
      message: req.body.message || req.body.caption || `[${req.body.type || 'text'}]`,
      messageId: result?.key?.id || null,
      waTimestamp: new Date(),
    });

    res.json({ success: true, instanceId: instance._id, messageId: result?.key?.id || null });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
}

export async function updateTenantWebhook(req, res) {
  const { webhookUrl } = req.body;
  const tenant = await Tenant.findOne({ _id: req.params.id, app: req.developerApp._id });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  tenant.webhookUrl = webhookUrl || null;
  await tenant.save();
  res.json({ tenant: { id: tenant._id, webhookUrl: tenant.webhookUrl } });
}
