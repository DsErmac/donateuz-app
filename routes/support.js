const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sendEmail, escapeHtml, layout } = require('../services/email');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['Medical', 'Education', 'Food', 'Relief'];
const MAX_TARGET_CENTS = 100000000; // $1,000,000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Campaign ids end up in inline onclick handlers and URLs, so they are generated here from a
// strict [a-z0-9-] alphabet. Non-Latin titles fall back to "campaign".
function makeCampaignId(title) {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `${slug || 'campaign'}-${crypto.randomBytes(3).toString('hex')}`;
}

async function notifyRequester(userId, subject, title, bodyHtml) {
  if (!userId) return;
  try {
    const u = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (u.rows[0]) await sendEmail({ to: u.rows[0].email, subject, html: layout(title, bodyHtml) });
  } catch (err) {
    console.error('[support] notify error', err.message);
  }
}

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { title, category, region, targetAmountCents, story } = req.body || {};
    const target = Number(targetAmountCents);

    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
    if (title.trim().length > 120) return res.status(400).json({ error: 'Title must be 120 characters or fewer.' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose a valid category.' });
    if (typeof region !== 'string' || !region.trim()) return res.status(400).json({ error: 'Region is required.' });
    if (region.trim().length > 80) return res.status(400).json({ error: 'Region must be 80 characters or fewer.' });
    if (!Number.isInteger(target) || target < 100 || target > MAX_TARGET_CENTS) {
      return res.status(400).json({ error: 'Enter a valid target amount.' });
    }
    if (typeof story !== 'string' || !story.trim()) return res.status(400).json({ error: 'Please describe the support needed.' });
    if (story.trim().length > 5000) return res.status(400).json({ error: 'Description must be 5000 characters or fewer.' });

    const result = await pool.query(
      `INSERT INTO support_requests (user_id, title, category, region, target_amount_cents, story)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, status, created_at`,
      [req.user ? req.user.id : null, title.trim(), category, region.trim(), target, story.trim()]
    );
    // Only echo back what the submitter needs; the full row is for admins.
    res.status(201).json({ request: result.rows[0] });
  } catch (err) {
    console.error('[support] submit error', err);
    res.status(500).json({ error: 'Could not submit your request. Please try again.' });
  }
});

// Admin review queue. Requires users.role = 'admin' (grant with: npm run make-admin -- you@example.com).
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM support_requests WHERE status = 'pending_review' ORDER BY created_at DESC`
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error('[support] list error', err);
    res.status(500).json({ error: 'Could not load support requests.' });
  }
});

// Approve: creates a live campaign from the request, atomically. Optional body: { urgency: 1-5 }.
router.post('/:id/approve', requireAdmin, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid request id.' });
  const urgency = req.body && req.body.urgency !== undefined ? Number(req.body.urgency) : 5;
  if (!Number.isInteger(urgency) || urgency < 1 || urgency > 5) return res.status(400).json({ error: 'Urgency must be between 1 and 5.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE: two admins clicking at once can't both approve the same request.
    const found = await client.query(`SELECT * FROM support_requests WHERE id = $1 AND status = 'pending_review' FOR UPDATE`, [req.params.id]);
    const request = found.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found or already reviewed.' });
    }
    const campaignId = makeCampaignId(request.title);
    const campaign = await client.query(
      `INSERT INTO campaigns (id, title, category, region, story, image_seed, goal_amount_cents, urgency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title`,
      [campaignId, request.title, request.category, request.region, request.story, campaignId, request.target_amount_cents, urgency]
    );
    await client.query(
      `UPDATE support_requests SET status = 'approved', reviewed_by = $1, reviewed_at = now(), campaign_id = $2 WHERE id = $3`,
      [req.user.id, campaignId, request.id]
    );
    await client.query('COMMIT');

    notifyRequester(request.user_id, 'Your DonateUZ campaign is live', 'Your campaign was approved',
      `<p>Good news — <strong>${escapeHtml(request.title)}</strong> passed review and is now live on DonateUZ.</p>`);
    res.json({ campaign: campaign.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[support] approve error', err);
    res.status(500).json({ error: 'Could not approve this request.' });
  } finally {
    client.release();
  }
});

// Reject: optional body { note } (shown to the requester by email).
router.post('/:id/reject', requireAdmin, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid request id.' });
  const note = req.body && typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (note.length > 500) return res.status(400).json({ error: 'Note must be 500 characters or fewer.' });
  try {
    const result = await pool.query(
      `UPDATE support_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_note = $2
       WHERE id = $3 AND status = 'pending_review' RETURNING id, user_id, title`,
      [req.user.id, note || null, req.params.id]
    );
    const request = result.rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found or already reviewed.' });

    notifyRequester(request.user_id, 'Update on your DonateUZ request', 'Your request was not approved',
      `<p>We could not approve <strong>${escapeHtml(request.title)}</strong> at this time.</p>` +
      (note ? `<p><em>Reviewer note:</em> ${escapeHtml(note)}</p>` : '') +
      '<p>You are welcome to submit a new request with more detail or documentation.</p>');
    res.json({ ok: true });
  } catch (err) {
    console.error('[support] reject error', err);
    res.status(500).json({ error: 'Could not reject this request.' });
  }
});

module.exports = router;
