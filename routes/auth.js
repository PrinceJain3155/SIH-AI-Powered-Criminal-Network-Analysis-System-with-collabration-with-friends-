const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { optionalAuth, requireAuth, resolveUserFromToken } = require('../middleware/auth');

const router = express.Router();
const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const REFRESH_COOKIE = 'cdr_refresh_token';
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [key, entry] of loginAttempts) {
    if (entry.firstAttemptAt < cutoff) loginAttempts.delete(key);
  }
}, LOGIN_WINDOW_MS).unref();

function validateCredentials({ username, email, password }) {
  if (!username || typeof username !== 'string' || username.trim().length < 3) return 'A valid username is required';
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'A valid email is required';
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return 'Password must be at least 8 characters';
  return null;
}

function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), type: 'access' }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefreshToken(user) {
  return jwt.sign({ sub: String(user._id), type: 'refresh' }, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

function safeUser(user) {
  const obj = user && typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
  delete obj.passwordHash;
  return obj;
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimitKey(req) {
  return `${getClientIp(req)}:${String(req.body?.username || '').trim().toLowerCase()}`;
}

function isLoginLimited(req) {
  const key = rateLimitKey(req);
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.failures >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(req) {
  const key = rateLimitKey(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAttemptAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { firstAttemptAt: now, failures: 1 });
  } else {
    entry.failures += 1;
  }
}

function clearLoginFailures(req) {
  loginAttempts.delete(rateLimitKey(req));
}

// POST /api/auth/signup
router.post('/signup', optionalAuth, asyncHandler(async (req, res) => {
  const error = validateCredentials(req.body || {});
  if (error) return res.status(400).json({ error });

  const username = req.body.username.trim();
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;
  const requestedRole = req.body.role;

  if (requestedRole && requestedRole !== 'investigator' && requestedRole !== 'admin') {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (requestedRole === 'admin' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can create another admin' });
  }
  if (await User.exists({ $or: [{ username }, { email }] })) {
    return res.status(409).json({ error: 'Username or email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ username, email, passwordHash, role: requestedRole || 'investigator' });
  res.status(201).json({ user: safeUser(user) });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (isLoginLimited(req)) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  const user = await User.findOne({ username }).select('+passwordHash');
  const valid = !!user && user.status === 'active' && await bcrypt.compare(password, user.passwordHash || '');
  if (!valid) {
    recordLoginFailure(req);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearLoginFailures(req);
  user.lastLoginAt = new Date();
  await user.save();

  setRefreshCookie(res, signRefreshToken(user));
  res.json({ accessToken: signAccessToken(user), user: safeUser(user) });
}));

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const user = await resolveUserFromToken(token, { refresh: true });
    res.json({ accessToken: signAccessToken(user), user: safeUser(user) });
  } catch (_err) {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Authentication required' });
  }
}));

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: safeUser(req.user) });
}));

module.exports = router;
