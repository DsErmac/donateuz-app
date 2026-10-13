// "Goal reached" notifications: the moment a campaign first crosses its funding
// goal, everyone who gave to it gets an email. Never throws — a failed
// notification must never break a payment, and never re-spam on webhook retries.

const pool = require('../db/pool');
const { sendEmail, escapeHtml, layout } = require('./email');

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(Number(cents) / 100);
  } catch (e) {
    return `${(Number(cents) / 100).toFixed(2)} ${currency || 'usd'}`;
  }
}

const APP_CURRENCY = (process.env.STRIPE_CURRENCY || 'usd');

// Atomically claims the "goal reached" moment for a campaign. Returns the
// campaign row only for the FIRST call that finds the goal crossed — retried
// webhooks and concurrent requests all see goal_reached_at already set.
async function claimGoalReached(campaignId) {
  const result = await pool.query(
    `UPDATE campaigns c
       SET goal_reached_at = now()
     WHERE c.id = $1
       AND c.goal_reached_at IS NULL
       AND c.goal_amount_cents > 0
       AND c.seed_raised_amount_cents
           + COALESCE((SELECT SUM(d.amount_cents) FROM donations d
                        WHERE d.campaign_id = c.id AND d.status = 'completed'), 0)
           >= c.goal_amount_cents
     RETURNING c.id, c.title, c.goal_amount_cents, c.region`,
    [campaignId]
  );
  return result.rows[0] || null;
}

// Distinct reachable emails of completed donors: registered users via their
// account email, guests via the email stored from the Stripe session.
async function donorEmailsFor(campaignId) {
  const result = await pool.query(
    `SELECT DISTINCT COALESCE(u.email, d.donor_email) AS email
       FROM donations d
       LEFT JOIN users u ON u.id = d.user_id
      WHERE d.campaign_id = $1
        AND d.status = 'completed'
        AND COALESCE(u.email, d.donor_email) IS NOT NULL`,
    [campaignId]
  );
  return result.rows.map(r => r.email);
}

function goalEmail(campaign) {
  const amount = formatMoney(campaign.goal_amount_cents, APP_CURRENCY);
  const html = layout('You did it — the goal is reached', `
    <p>Good news! <strong>${escapeHtml(campaign.title)}</strong> in ${escapeHtml(campaign.region)} has reached its funding goal of <strong>${amount}</strong>.</p>
    <p>Your gift was part of that. Thank you for making it happen — 100% of the funds go to the cause.</p>`);
  const text = `Good news! ${campaign.title} in ${campaign.region} has reached its funding goal of ${amount}.\n\nYour gift was part of that. Thank you for making it happen.\n`;
  return { subject: `Goal reached: ${campaign.title}`, html, text };
}

// Called after any donation completes (webhook, verify route, renewal). Safe to
// call repeatedly; fire-and-forget — do not await from the payment path.
async function notifyGoalReached(campaignId) {
  if (!campaignId || !process.env.RESEND_API_KEY) return;
  try {
    const campaign = await claimGoalReached(campaignId);
    if (!campaign) return;
    const emails = await donorEmailsFor(campaignId);
    console.log(`[goals] "${campaign.title}" reached its goal — notifying ${emails.length} donor(s)`);
    const { subject, html, text } = goalEmail(campaign);
    await Promise.allSettled(emails.map(to => sendEmail({ to, subject, html, text })));
  } catch (err) {
    console.error('[goals] notify error', err.message);
  }
}

module.exports = { notifyGoalReached };
