// Auth state lives entirely in the server-side session (stored in MongoDB via connect-mongo).
// req.session.role is 'admin' or 'subadmin'; req.session.userId is set only for sub-admins.

export function requireAuth(req, res, next) {
  if (!req.session || !req.session.role) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  req.role = req.session.role;
  req.ownerId = req.session.userId || null;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
