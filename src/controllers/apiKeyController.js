import ApiKey from '../models/ApiKey.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

function ownerFilter(req) {
  return { ownerRole: req.role, ownerId: req.role === 'admin' ? null : req.ownerId };
}

export async function listApiKeys(req, res) {
  const keys = await ApiKey.find(ownerFilter(req)).sort({ createdAt: -1 });
  res.json({
    apiKeys: keys.map((k) => ({
      id: k._id,
      label: k.label,
      prefix: k.prefix,
      revoked: k.revoked,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })),
  });
}

export async function createApiKey(req, res) {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required' });

  const { key, prefix } = generateApiKey();
  const record = await ApiKey.create({ ...ownerFilter(req), label, prefix, keyHash: hashApiKey(key) });

  res.status(201).json({
    apiKey: { id: record._id, label: record.label, prefix: record.prefix, createdAt: record.createdAt },
    key, // shown once
  });
}

export async function revokeApiKey(req, res) {
  const record = await ApiKey.findOne({ _id: req.params.id, ...ownerFilter(req) });
  if (!record) return res.status(404).json({ error: 'API key not found' });

  record.revoked = true;
  await record.save();
  res.json({ message: 'API key revoked' });
}

export async function deleteApiKey(req, res) {
  const record = await ApiKey.findOneAndDelete({ _id: req.params.id, ...ownerFilter(req) });
  if (!record) return res.status(404).json({ error: 'API key not found' });
  res.json({ message: 'API key deleted' });
}
