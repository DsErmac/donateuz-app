const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/stats - public, anonymous platform totals for the home page.
// Only completed money is counted. donorCount dedupes by account, falling back
// to donor name; guest donations sharing a name collapse into one donor.
router.get('/', async (req, res) => {
  try {
    const [donationsResult, campaignsResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'completed'), 0) AS total_amount_cents,
          COUNT(*) FILTER (WHERE status = 'completed') AS total_donations,
          COUNT(DISTINCT COALESCE(user_id::text, NULLIF(donor_name, ''))) FILTER (WHERE status = 'completed') AS donor_count
        FROM donations`),
      pool.query(`SELECT COUNT(*) AS active_campaigns FROM campaigns WHERE status = 'active'`)
    ]);

    const d = donationsResult.rows[0];
    res.json({
      totalRaisedCents: Number(d.total_amount_cents || 0),
      totalDonations: Number(d.total_donations || 0),
      donorCount: Number(d.donor_count || 0),
      activeCampaigns: Number(campaignsResult.rows[0].active_campaigns || 0)
    });
  } catch (err) {
    console.error('[stats] error', err);
    res.status(500).json({ error: 'Could not load platform stats.' });
  }
});

module.exports = router;
