const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Case = require('../models/Case');

function getBearerToken(req) {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function resolveUserFromToken(token, { refresh = false } = {}) {
  const secret = refresh ? process.env.JWT_REFRESH_SECRET : process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT secret is not configured');
  const payload = jwt.verify(token, secret);
  if (refresh && payload.type !== 'refresh') throw new Error('Invalid refresh token');
  if (!refresh && payload.type !== 'access') throw new Error('Invalid access token');

  const user = await User.findById(payload.sub).lean();
  if (!user || user.status !== 'active') throw new Error('User unavailable');
  return user;
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    req.user = await resolveUserFromToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

async function optionalAuth(req, _res, next) {
  try {
    const token = getBearerToken(req);
    if (token) req.user = await resolveUserFromToken(token);
  } catch (_err) {
    // Public endpoints remain public when an absent/expired token is supplied.
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

async function assertCaseAccess(req, res, caseId) {
  const caseDoc = await Case.findOne({ id: caseId }).lean();
  if (!caseDoc) {
    res.status(404).json({ error: 'Case not found' });
    return null;
  }
  if (req.user.role !== 'admin' && caseDoc.officer !== req.user.username) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return caseDoc;
}

function caseAccessFilter(req) {
  return req.user.role === 'admin' ? {} : { officer: req.user.username };
}

module.exports = {
  getBearerToken,
  resolveUserFromToken,
  requireAuth,
  optionalAuth,
  requireRole,
  assertCaseAccess,
  caseAccessFilter,
};
