const express = require('express');
const crypto = require('crypto');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

// Every admin route requires a signed-in user whose CURRENT database role is 'admin'
// (grant with: npm run make-admin -- you@example.com).
router.use(requireAdmin);

// The same four categories the public app filters by — keeping them in sync means
// admin-created campaigns always appear under the right "Explore" chip.
const CATEGORIES = ['Medical', 'Education', 'Food', 'Relief'];
const CAMPAIGN_STATUSES = ['active', 'closed'];
const MIN_GOAL_CENTS = 100;           // $1.00
const MAX_GOAL_CENTS = 100000000;     // $1,000,000.00
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Clamp paging params: garbage like ?limit=abc or ?offset=-5 would otherwise
// reach Postgres and surface as a 500.
function paging(query, defLimit = 50, maxLimit = 200) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defLimit, 1), maxLimit);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// Campaign ids end up in inline onclick handlers and URLs, so they come from a strict
// [a-z0-9-] alphabet. The random suffix keeps two similar titles from colliding.
function makeCampaignId(title) {
  const slug = title.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '');
  return `${slug || 'campaign'}-${crypto.randomBytes(3).toString('hex')}`;
}

function parseGoalCents(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_GOAL_CENTS && n <= MAX_GOAL_CENTS ? n : null;
}

function parseUrgency(value, fallback = 3) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// ---------- Overview statistics ----------

// GET /api/admin/stats - overview statistics for the dashboard
router.get('/stats', async (req, res) => {
  try {
    const [donationsResult, campaignsResult, requestsResult, usersResult] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed') AS total_donations,
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'completed'), 0) AS total_amount_cents,
          COUNT(*) FILTER (WHERE status = 'completed' AND recurring) AS recurring_count,
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('month', now())), 0) AS month_amount_cents,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_donations,
          COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_donations
        FROM donations`),
      pool.query(`SELECT COUNT(*) AS active_campaigns FROM campaigns WHERE status = 'active'`),
      pool.query(`SELECT COUNT(*) AS pending_requests FROM support_requests WHERE status = 'pending_review'`),
      pool.query(`SELECT COUNT(*) AS total_users FROM users`)
    ]);

    const d = donationsResult.rows[0];
    const totalDonations = Number(d.total_donations || 0);
    const totalAmountCents = Number(d.total_amount_cents || 0);

    res.json({
      totalDonations,
      totalAmountCents,
      avgDonationCents: totalDonations > 0 ? Math.round(totalAmountCents / totalDonations) : 0,
      monthAmountCents: Number(d.month_amount_cents || 0),
      recurringCount: Number(d.recurring_count || 0),
      pendingDonations: Number(d.pending_donations || 0),
      refundedDonations: Number(d.refunded_donations || 0),
      activeCampaigns: Number(campaignsResult.rows[0].active_campaigns || 0),
      pendingRequests: Number(requestsResult.rows[0].pending_requests || 0),
      totalUsers: Number(usersResult.rows[0].total_users || 0)
    });
  } catch (err) {
    console.error('[admin] stats error', err);
    res.status(500).json({ error: 'Could not load statistics.' });
  }
});

// ---------- Campaigns ----------

// GET /api/admin/campaigns - list all campaigns with real raised totals
router.get('/campaigns', async (req, res) => {
  try {
    const { search, category, status } = req.query;
    let query = `
      SELECT
        c.*,
        c.seed_raised_amount_cents + COALESCE(SUM(d.amount_cents) FILTER (WHERE d.status = 'completed'), 0) AS raised_amount_cents
      FROM campaigns c
      LEFT JOIN donations d ON d.campaign_id = c.id
    `;
    const params = [];
    const conditions = [];

    if (search) {
      conditions.push(`(c.title ILIKE $${params.length + 1} OR c.region ILIKE $${params.length + 1} OR c.story ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    if (category) {
      conditions.push(`c.category = $${params.length + 1}`);
      params.push(category);
    }
    if (status) {
      conditions.push(`c.status = $${params.length + 1}`);
      params.push(status);
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

    query += ` GROUP BY c.id ORDER BY c.created_at DESC`;

    const result = await pool.query(query, params);
    const campaigns = result.rows.map(row => ({
      ...row,
      raisedAmountCents: Number(row.raised_amount_cents || 0),
      progress: Number(row.goal_amount_cents) > 0
        ? Math.min(100, Math.round((Number(row.raised_amount_cents) / Number(row.goal_amount_cents)) * 100))
        : 0
    }));

    res.json({ campaigns });
  } catch (err) {
    console.error('[admin] campaigns list error', err);
    res.status(500).json({ error: 'Could not load campaigns.' });
  }
});

// POST /api/admin/campaigns - create a new campaign
router.post('/campaigns', async (req, res) => {
  try {
    const { title, category, region, story, goalAmountCents, imageSeed, urgency, status } = req.body || {};

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
      return res.status(400).json({ error: 'Title is required (max 120 characters).' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}.` });
    }
    if (typeof region !== 'string' || !region.trim() || region.trim().length > 80) {
      return res.status(400).json({ error: 'Region is required (max 80 characters).' });
    }
    if (typeof story !== 'string' || !story.trim() || story.trim().length > 5000) {
      return res.status(400).json({ error: 'Story is required (max 5000 characters).' });
    }
    const goal = parseGoalCents(goalAmountCents);
    if (!goal) return res.status(400).json({ error: 'Enter a valid goal amount (between $1 and $1,000,000).' });
    const urg = parseUrgency(urgency);
    if (!urg) return res.status(400).json({ error: 'Urgency must be between 1 and 5.' });
    const initialStatus = status === undefined || status === '' ? 'active' : status;
    if (!CAMPAIGN_STATUSES.includes(initialStatus)) {
      return res.status(400).json({ error: 'Status must be "active" or "closed".' });
    }

    const seed = (typeof imageSeed === 'string' && imageSeed.trim())
      ? imageSeed.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60)
      : makeCampaignId(title).replace(/-[0-9a-f]{6}$/, ''); // stable photo per title

    const result = await pool.query(
      `INSERT INTO campaigns (id, title, category, region, story, image_seed, goal_amount_cents, seed_raised_amount_cents, urgency, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [makeCampaignId(title), title.trim(), category, region.trim(), story.trim(), seed, goal, 0, urg, initialStatus]
    );

    res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    console.error('[admin] campaign create error', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A campaign with that identifier already exists.' });
    }
    res.status(500).json({ error: 'Could not create campaign.' });
  }
});

// PUT /api/admin/campaigns/:id - update campaign fields (validated per field)
router.put('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, region, story, goalAmountCents, imageSeed, status, urgency } = req.body || {};

    const updates = [];
    const values = [];
    let paramIndex = 1;
    const add = (column, value) => { updates.push(`${column} = $${paramIndex++}`); values.push(value); };

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
        return res.status(400).json({ error: 'Title must be 1-120 characters.' });
      }
      add('title', title.trim());
    }
    if (category !== undefined) {
      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}.` });
      }
      add('category', category);
    }
    if (region !== undefined) {
      if (typeof region !== 'string' || !region.trim() || region.trim().length > 80) {
        return res.status(400).json({ error: 'Region must be 1-80 characters.' });
      }
      add('region', region.trim());
    }
    if (story !== undefined) {
      if (typeof story !== 'string' || !story.trim() || story.trim().length > 5000) {
        return res.status(400).json({ error: 'Story must be 1-5000 characters.' });
      }
      add('story', story.trim());
    }
    if (goalAmountCents !== undefined) {
      const goal = parseGoalCents(goalAmountCents);
      if (!goal) return res.status(400).json({ error: 'Enter a valid goal amount (between $1 and $1,000,000).' });
      add('goal_amount_cents', goal);
    }
    if (imageSeed !== undefined) {
      if (typeof imageSeed !== 'string' || !imageSeed.trim()) {
        return res.status(400).json({ error: 'Image seed must be a non-empty string.' });
      }
      add('image_seed', imageSeed.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60));
    }
    if (status !== undefined) {
      if (!CAMPAIGN_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Status must be "active" or "closed".' });
      }
      add('status', status);
    }
    if (urgency !== undefined) {
      const urg = parseUrgency(urgency, null);
      if (!urg) return res.status(400).json({ error: 'Urgency must be between 1 and 5.' });
      add('urgency', urg);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(id); // for the WHERE clause
    const result = await pool.query(
      `UPDATE campaigns SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    res.json({ campaign: result.rows[0] });
  } catch (err) {
    console.error('[admin] campaign update error', err);
    res.status(500).json({ error: 'Could not update campaign.' });
  }
});

// DELETE /api/admin/campaigns/:id - delete campaign (blocked once real donations exist)
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Completed donations are real money history; close the campaign instead of deleting it.
    const checkResult = await pool.query(
      `SELECT COUNT(*) AS count FROM donations WHERE campaign_id = $1 AND status = 'completed'`,
      [id]
    );
    if (Number(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete a campaign with completed donations — close it instead.' });
    }

    const result = await pool.query(`DELETE FROM campaigns WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin] campaign delete error', err);
    res.status(500).json({ error: 'Could not delete campaign.' });
  }
});

// ---------- Donations ----------

// GET /api/admin/donations - list donations with donor info (server-side filters + paging)
router.get('/donations', async (req, res) => {
  try {
    const { status, campaignId, userId, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT d.*, u.name AS user_name, u.email AS user_email
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
    `;
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push(`d.status = $${params.length + 1}`);
      params.push(status);
    }
    if (campaignId) {
      conditions.push(`d.campaign_id = $${params.length + 1}`);
      params.push(campaignId);
    }
    if (userId) {
      if (!UUID_RE.test(userId)) return res.status(400).json({ error: 'Invalid user id.' });
      conditions.push(`d.user_id = $${params.length + 1}`);
      params.push(userId);
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

    query += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const { limit: safeLimit, offset: safeOffset } = paging(req.query);
    params.push(safeLimit, safeOffset);

    const result = await pool.query(query, params);
    // camelCase aliases keep the admin frontend (render/search/CSV export) in line
    // with the shape every other donations endpoint already returns.
    const donations = result.rows.map(row => ({
      ...row,
      campaignTitle: row.campaign_title,
      donorName: row.donor_name,
      amountCents: Number(row.amount_cents),
      anonymous: !!row.anonymous,
      recurring: !!row.recurring
    }));

    res.json({ donations, count: donations.length });
  } catch (err) {
    console.error('[admin] donations list error', err);
    res.status(500).json({ error: 'Could not load donations.' });
  }
});

// POST /api/admin/donations/:id/refund - refund a completed one-time donation via Stripe.
router.post('/donations/:id/refund', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured on the server.' });
    }
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid donation id.' });

    const result = await pool.query('SELECT * FROM donations WHERE id = $1', [req.params.id]);
    const donation = result.rows[0];
    if (!donation) return res.status(404).json({ error: 'Donation not found.' });
    if (donation.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed donations can be refunded.' });
    }
    if (donation.recurring) {
      return res.status(400).json({ error: 'Monthly donations cannot be refunded mid-cycle — use "Cancel monthly" instead.' });
    }
    if (!donation.stripe_payment_intent) {
      return res.status(400).json({ error: 'No Stripe payment is stored for this donation.' });
    }

    await stripe.refunds.create({ payment_intent: donation.stripe_payment_intent });
    const updated = await pool.query(`UPDATE donations SET status = 'refunded' WHERE id = $1 RETURNING *`, [donation.id]);
    res.json({ donation: updated.rows[0] });
  } catch (err) {
    console.error('[admin] refund error', err.message);
    res.status(500).json({ error: 'Could not refund this donation.', detail: err.raw ? err.raw.message : undefined });
  }
});

// POST /api/admin/donations/:id/cancel - stop future renewals of a monthly donation.
// The donor keeps what they already paid for: it cancels at period end, not immediately.
router.post('/donations/:id/cancel', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured on the server.' });
    }
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid donation id.' });

    const result = await pool.query('SELECT * FROM donations WHERE id = $1', [req.params.id]);
    const donation = result.rows[0];
    if (!donation) return res.status(404).json({ error: 'Donation not found.' });
    if (!donation.recurring) {
      return res.status(400).json({ error: 'Only monthly donations can be cancelled.' });
    }
    if (donation.status !== 'completed') {
      return res.status(400).json({ error: 'This monthly donation is not active.' });
    }
    if (!donation.stripe_subscription_id) {
      return res.status(400).json({ error: 'No Stripe subscription is stored for this donation.' });
    }

    await stripe.subscriptions.update(donation.stripe_subscription_id, { cancel_at_period_end: true });
    // Money already collected on this row stays 'completed' — cancelling stops
    // FUTURE renewals only. Marking a paid row 'cancelled' would retroactively
    // un-count collected money from campaign totals and the donor's history.
    await pool.query(`UPDATE donations SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [donation.id]);
    const updated = await pool.query(`SELECT * FROM donations WHERE id = $1`, [donation.id]);
    res.json({ donation: updated.rows[0] });
  } catch (err) {
    console.error('[admin] cancel error', err.message);
    res.status(500).json({ error: 'Could not cancel this monthly donation.', detail: err.raw ? err.raw.message : undefined });
  }
});

// ---------- Users ----------

// GET /api/admin/users - list users
router.get('/users', async (req, res) => {
  try {
    const { search, role, limit = 50, offset = 0 } = req.query;
    let query = 'SELECT id, name, email, role, created_at FROM users';
    const params = [];
    const conditions = [];

    if (search) {
      conditions.push(`(name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    if (role) {
      conditions.push(`role = $${params.length + 1}`);
      params.push(role);
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const { limit: safeLimit, offset: safeOffset } = paging(req.query);
    params.push(safeLimit, safeOffset);

    const result = await pool.query(query, params);
    res.json({ users: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[admin] users list error', err);
    res.status(500).json({ error: 'Could not load users.' });
  }
});

// PUT /api/admin/users/:id/role - promote to admin or demote back to user.
// An admin can't change their own role: that's how you end up locked out of the dashboard.
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: "Role must be 'admin' or 'user'." });
    }
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid user id.' });
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role. Ask another admin.' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
      [role, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[admin] user role error', err);
    res.status(500).json({ error: 'Could not update the user role.' });
  }
});

// ---------- Support requests ----------

// GET /api/admin/support-requests - all support requests, newest first
router.get('/support-requests', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT sr.*, u.name AS user_name, u.email AS user_email
      FROM support_requests sr
      LEFT JOIN users u ON sr.user_id = u.id
    `;
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push(`sr.status = $${params.length + 1}`);
      params.push(status);
    }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

    query += ` ORDER BY sr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const { limit: safeLimit, offset: safeOffset } = paging(req.query);
    params.push(safeLimit, safeOffset);

    const result = await pool.query(query, params);
    res.json({ requests: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[admin] support requests list error', err);
    res.status(500).json({ error: 'Could not load support requests.' });
  }
});

module.exports = router;
