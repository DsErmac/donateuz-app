const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { signToken, setAuthCookie, clearAuthCookie, optionalAuth } = require('../middleware/auth');
const { sendEmail } = require('../services/email');

const router = express.Router();

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return res.status(400).json({ error: 'Name is required (max 100 characters).' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (password.length > 72) return res.status(400).json({ error: 'Password must be at most 72 characters.' }); // bcrypt ignores anything longer

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name.trim(), email.toLowerCase(), passwordHash]
    );
    const user = result.rows[0];
    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: 'user' } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    console.error('[auth] register error', err);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    // Burn a bcrypt compare even when the account doesn't exist, so response
    // timing can't distinguish "no such account" from "wrong password" and
    // undermine the no-enumeration design of forgot-password.
    const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8DsAMd4wDyPAxmPEWoN8sEAFnC2uHq';
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !match) return res.status(401).json({ error: 'Incorrect email or password.' });

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('[auth] login error', err);
    res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ---------- Password reset ----------
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Always answers 200 so the endpoint can't be used to learn whether an email
// is registered. The reset link is a raw one-time token in the URL fragment
// (never a server-logged query string); only its SHA-256 is stored.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) return res.json({ ok: true });

    const user = await pool.query('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase()]);
    if (user.rows[0] && process.env.RESEND_API_KEY) {
      const raw = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
        [user.rows[0].id, hashToken(raw)]
      );
      // Multiple concurrent requests each get a valid token: they don't
      // invalidate each other (each link is single-use anyway), so a double
      // click can't dead-end the link that was already emailed.
      const link = `${APP_URL}/#reset/${raw}`;
      const sent = await sendEmail({
        to: email.toLowerCase(),
        subject: 'Reset your DonateUZ password',
        html: `<p>Hi there, we received a request to reset your DonateUZ password.</p>
               <p><a href="${link}" style="display:inline-block;background:#1d6fa3;color:#fff;text-decoration:none;padding:10px 22px;border-radius:10px;font-weight:bold">Choose a new password</a></p>
               <p style="font-size:13px;color:#5b7473">This link works once and expires in 1 hour. If you didn't request it, you can safely ignore this email.</p>`,
        text: `Reset your DonateUZ password: ${link}\n\nThis link works once and expires in 1 hour. If you didn't request it, you can safely ignore this email.`
      });
      console.log(`[auth] password reset requested for ${email.toLowerCase()} — email ${sent ? 'sent' : 'could not be sent'}`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] forgot-password error', err);
    res.json({ ok: true }); // never leak account existence through error shapes
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'This reset link is invalid. Request a new one.' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (password.length > 72) return res.status(400).json({ error: 'Password must be at most 72 characters.' });

    const claimed = await pool.query(
      `UPDATE password_resets
          SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hashToken(token)]
    );
    const reset = claimed.rows[0];
    if (!reset) return res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' });

    const passwordHash = await bcrypt.hash(password, 10);
    // token_version bump voids every JWT issued before this moment.
    await pool.query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [passwordHash, reset.user_id]);
    // A password change voids every other outstanding reset token.
    await pool.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [reset.user_id]);

    const user = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [reset.user_id]);
    if (user.rows[0]) setAuthCookie(res, signToken(user.rows[0])); // signed in on reset
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] reset-password error', err);
    res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
});

router.get('/me', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ user: null });
  try {
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.json({ user: null }); // account was deleted
    res.json({ user: { ...req.user, role: result.rows[0].role } });
  } catch (err) {
    console.error('[auth] me error', err);
    res.json({ user: req.user });
  }
});

module.exports = router;
