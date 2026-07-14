import User from '../models/User.js';

// Admin has no DB row - possession of ADMIN_API_KEY (set in .env) is the credential.
export async function adminLogin(req, res) {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Invalid admin API key' });
  }

  req.session.role = 'admin';
  req.session.userId = null;
  res.json({ account: { role: 'admin', name: 'Admin', email: null } });
}

// Sub-admin login with email + password (account created by Admin beforehand).
export async function subadminLogin(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = await User.findOne({ email: email.toLowerCase(), role: 'subadmin' });
  if (!user || !user.active || !(await user.comparePassword(password))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  req.session.role = 'subadmin';
  req.session.userId = user._id.toString();
  res.json({ account: { role: 'subadmin', ...user.toSafeJSON() } });
}

export async function me(req, res) {
  if (!req.session?.role) return res.status(401).json({ error: 'Not logged in' });

  if (req.session.role === 'admin') {
    return res.json({ account: { role: 'admin', name: 'Admin', email: null } });
  }

  const user = await User.findById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  res.json({ account: { role: 'subadmin', ...user.toSafeJSON() } });
}

export function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('wirebase.sid');
    res.json({ message: 'Logged out' });
  });
}
