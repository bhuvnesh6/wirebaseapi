import crypto from 'crypto';
import User from '../models/User.js';
import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import ApiKey from '../models/ApiKey.js';
import * as baileysManager from '../services/baileysManager.js';

function generatePassword() {
  // 12-char, easy-to-read password: no ambiguous chars like 0/O, 1/l
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pwd = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) pwd += chars[bytes[i] % chars.length];
  return pwd;
}

export async function listSubAdmins(req, res) {
  const subadmins = await User.find({ role: 'subadmin' }).sort({ createdAt: -1 });
  res.json({ subadmins: subadmins.map((s) => s.toSafeJSON()) });
}

// Creates a sub-admin with an auto-generated password. The plaintext password is returned
// ONLY in this response - it is never stored or retrievable again.
export async function createSubAdmin(req, res) {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const password = generatePassword();
  const passwordHash = await User.hashPassword(password);
  const subadmin = await User.create({ name, email: email.toLowerCase(), passwordHash, role: 'subadmin' });

  res.status(201).json({
    subadmin: subadmin.toSafeJSON(),
    credentials: { email: subadmin.email, password }, // shown once
  });
}

export async function toggleSubAdmin(req, res) {
  const subadmin = await User.findOne({ _id: req.params.id, role: 'subadmin' });
  if (!subadmin) return res.status(404).json({ error: 'Sub-admin not found' });

  subadmin.active = req.body.active !== undefined ? !!req.body.active : !subadmin.active;
  await subadmin.save();
  res.json({ subadmin: subadmin.toSafeJSON() });
}

export async function resetSubAdminPassword(req, res) {
  const subadmin = await User.findOne({ _id: req.params.id, role: 'subadmin' });
  if (!subadmin) return res.status(404).json({ error: 'Sub-admin not found' });

  const password = generatePassword();
  subadmin.passwordHash = await User.hashPassword(password);
  await subadmin.save();

  res.json({ subadmin: subadmin.toSafeJSON(), credentials: { email: subadmin.email, password } });
}

export async function deleteSubAdmin(req, res) {
  const subadmin = await User.findOne({ _id: req.params.id, role: 'subadmin' });
  if (!subadmin) return res.status(404).json({ error: 'Sub-admin not found' });

  const instances = await Instance.find({ ownerRole: 'subadmin', ownerId: subadmin._id });
  for (const inst of instances) {
    await baileysManager.stopInstance(inst._id.toString(), { wipeSession: true });
    await Message.deleteMany({ instance: inst._id });
  }
  await Instance.deleteMany({ ownerRole: 'subadmin', ownerId: subadmin._id });
  await ApiKey.deleteMany({ ownerRole: 'subadmin', ownerId: subadmin._id });
  await subadmin.deleteOne();

  res.json({ message: 'Sub-admin and their instances/API keys removed' });
}
