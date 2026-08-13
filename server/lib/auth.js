'use strict';
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, SECRET, { expiresIn: '7d' });
}

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

// Require any logged-in staff member.
function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

// Require a specific role (super_admin implicitly passes admin checks).
function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      const ok = roles.includes(req.user.role) || req.user.role === 'super_admin';
      if (!ok) return res.status(403).json({ error: 'You do not have permission for this action.' });
      next();
    });
  };
}

module.exports = { sign, requireAuth, requireRole };
