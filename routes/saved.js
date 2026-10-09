const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All saved-campaign routes require an account — this feature exists precisely
// so bookmarks survive switching devices, which localStorage can't do.

// List the campaign ids the signed-in user has saved.
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT campaign_id FROM saved_campaigns WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ saved: result.rows.map(r => r.campaign_id) });
  } catch (err) {
    console.error('[saved] list error', err);
    res.status(500).json({ error: 'Could not load saved campaigns.' });
  }
});

// Save a campaign (idempotent — saving twice is not an error).
router.put('/:campaignId', requireAuth, async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await pool.query('SELECT id FROM campaigns WHERE id = $1', [campaignId]);
    if (!campaign.rows[0]) return res.status(404).json({ error: 'Campaign not found.' });

    await pool.query(
      'INSERT INTO saved_campaigns (user_id, campaign_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, campaignId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[saved] add error', err);
    res.status(500).json({ error: 'Could not save the campaign.' });
  }
});

// Remove a saved campaign (missing rows are simply ignored).
router.delete('/:campaignId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM saved_campaigns WHERE user_id = $1 AND campaign_id = $2',
      [req.user.id, req.params.campaignId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[saved] remove error', err);
    res.status(500).json({ error: 'Could not remove the saved campaign.' });
  }
});

module.exports = router;
