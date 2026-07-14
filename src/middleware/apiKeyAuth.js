import ApiKey from '../models/ApiKey.js';
import { hashApiKey } from '../utils/apiKey.js';

// Public endpoints authenticate with an API key instead of a session cookie.
// Accepts either an `X-API-Key` header or `Authorization: Bearer <key>`.
export async function requireApiKey(req, res, next) {
  const headerKey = req.headers['x-api-key'];
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const key = headerKey || bearer;

  if (!key) {
    return res.status(401).json({ error: 'Missing API key. Send it in the X-API-Key header.' });
  }

  const keyHash = hashApiKey(key);
  const record = await ApiKey.findOne({ keyHash, revoked: false });
  if (!record) {
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  }

  record.lastUsedAt = new Date();
  record.save().catch(() => {});

  req.apiKeyOwnerRole = record.ownerRole;
  req.apiKeyOwnerId = record.ownerId;
  next();
}
