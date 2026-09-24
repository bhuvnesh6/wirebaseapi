import DeveloperApp from '../models/DeveloperApp.js';

export async function requireDeveloperApp(req, res, next) {
  const headerSecret = req.headers['x-firebase-app-key'];
  const headerClientId = req.headers['x-firebase-client-id'];

  const authHeader = req.headers.authorization || '';
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const secret = headerSecret || bearerSecret;
  const clientId = headerClientId || req.query.clientId || req.body?.clientId || null;

  if (!secret) {
    return res.status(401).json({ error: 'Missing developer app secret. Send Authorization: Bearer <app-secret> or X-Firebase-App-Key.' });
  }

  let app = null;

  if (clientId) {
    app = await DeveloperApp.findOne({ clientId, status: 'active' }).populate('developer');
  }

  if (!app) {
    app = await DeveloperApp.findOne({ status: 'active' }).populate('developer');
  }

  if (!app) {
    return res.status(401).json({ error: 'Invalid developer app credentials' });
  }

  const isValid = await app.compareClientSecret(secret);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid developer app secret' });
  }

  req.developerApp = app;
  req.developer = app.developer;
  next();
}
