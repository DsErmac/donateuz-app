const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const COOKIE_NAME = 'donateuz_token';

// Fail loudly at startup instead of at the first login attempt.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set in .env and be at least 32 characters (try: openssl rand -base64 48).');
  process.exit(1);
}

function signToken(user) {
  // Role is deliberately NOT stored in the token: it is read from the database on each
  // admin request, so demoting someone takes effect immediately.
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
}

function readUserFromRequest(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return { id: payload.sub, email: payload.email, name: payload.name };
  } catch (err) {
    return null;
  }
}

// Attaches req.user if a valid cookie is present; never blocks the request.
function optionalAuth(req, res, next) {
  req.user = readUserFromRequest(req);
  next();
}

// Attaches req.user or responds 401 if not authenticated.
function requireAuth(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  req.user = user;
  next();
}

// Requires a signed-in user whose CURRENT role in the database is 'admin'.
async function requireAdmin(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  try {
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [user.id]);
    if (!result.rows[0] || result.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.user = { ...user, role: 'admin' };
    next();
  } catch (err) {
    console.error('[auth] requireAdmin error', err);
    res.status(500).json({ error: 'Could not verify permissions.' });
  }
}

module.exports = { COOKIE_NAME, signToken, setAuthCookie, clearAuthCookie, optionalAuth, requireAuth, requireAdmin };
