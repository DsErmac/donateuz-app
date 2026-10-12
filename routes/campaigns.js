const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

const CAMPAIGN_QUERY = `
  SELECT
    c.id, c.title, c.category, c.region, c.story, c.image_seed,
    c.goal_amount_cents, c.urgency, c.status, c.goal_reached_at,
    c.seed_raised_amount_cents + COALESCE(SUM(d.amount_cents) FILTER (WHERE d.status = 'completed'), 0) AS raised_amount_cents
  FROM campaigns c
  LEFT JOIN donations d ON d.campaign_id = c.id
  WHERE c.status = 'active'
  GROUP BY c.id
  ORDER BY c.urgency ASC
`;

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(CAMPAIGN_QUERY);
    const campaigns = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      category: row.category,
      region: row.region,
      story: row.story,
      imageSeed: row.image_seed,
      urgency: row.urgency,
      goalAmountCents: Number(row.goal_amount_cents),
      raisedAmountCents: Number(row.raised_amount_cents),
      goalReachedAt: row.goal_reached_at,
      progress: Math.min(100, Math.round((Number(row.raised_amount_cents) / Number(row.goal_amount_cents)) * 100))
    }));
    res.json({ campaigns });
  } catch (err) {
    console.error('[campaigns] list error', err);
    res.status(500).json({ error: 'Could not load campaigns.' });
  }
});

module.exports = router;
