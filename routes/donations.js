const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { sendDonationReceipt } = require('../services/receipts');
const { notifyGoalReached } = require('../services/goals');
const { optionalAuth, requireAuth } = require('../middleware/auth');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
const CURRENCY = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Reasonable guardrails so a stray request can't create a $0 or absurd charge.
const MIN_AMOUNT_CENTS = 100; // $1.00
const MAX_AMOUNT_CENTS = 100000000; // $1,000,000.00

router.post('/checkout', optionalAuth, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured on the server yet.' });
    }
    const { campaignId, amountCents, donorName, anonymous, recurring } = req.body || {};
    const amount = Number(amountCents);

    if (!campaignId) return res.status(400).json({ error: 'A campaign is required.' });
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT_CENTS || amount > MAX_AMOUNT_CENTS) {
      return res.status(400).json({ error: 'Enter a valid donation amount.' });
    }

    const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1 AND status = $2', [campaignId, 'active']);
    const campaign = campaignResult.rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    const isRecurring = !!recurring;
    const isAnonymous = !!anonymous;
    const displayName = isAnonymous ? 'Anonymous donor' : (donorName && donorName.trim()) || (req.user ? req.user.name : 'DonateUZ supporter');

    const priceData = {
      currency: CURRENCY,
      unit_amount: amount,
      product_data: { name: `Donation to ${campaign.title}` }
    };
    if (isRecurring) priceData.recurring = { interval: 'month' };

    const sessionParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      // Donations are not the digital products Stripe's Managed Payments covers
      // (it rejects non-digital tax codes like Cash Donation), so opt the
      // session out — otherwise new Stripe accounts, where it's on by default,
      // fail with "the product tax code is missing".
      managed_payments: { enabled: false },
      line_items: [{ price_data: priceData, quantity: 1 }],
      client_reference_id: req.user ? req.user.id : undefined,
      customer_email: req.user ? req.user.email : undefined,
      success_url: `${APP_URL}/?donation=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?donation=cancelled`,
      metadata: {
        campaignId,
        campaignTitle: campaign.title,
        donorName: displayName,
        anonymous: String(isAnonymous),
        recurring: String(isRecurring),
        userId: req.user ? req.user.id : ''
      }
    };
    // Carry metadata onto the subscription too, so renewal invoices can be attributed to a campaign.
    if (isRecurring) sessionParams.subscription_data = { metadata: sessionParams.metadata };

    const session = await stripe.checkout.sessions.create(sessionParams);

    await pool.query(
      `INSERT INTO donations
        (user_id, campaign_id, campaign_title, donor_name, amount_cents, currency, anonymous, recurring, status, stripe_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [req.user ? req.user.id : null, campaignId, campaign.title, displayName, amount, CURRENCY, isAnonymous, isRecurring, session.id]
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error('[donations] checkout error', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// Public "recent impact" feed for the home page: newest completed gifts, donor names
// respected. Anonymous donations show as "Anonymous donor" — never the stored name.
router.get('/recent', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT campaign_id, campaign_title, donor_name, anonymous, amount_cents, currency, created_at
       FROM donations
       WHERE status = 'completed'
       ORDER BY created_at DESC
       LIMIT 6`
    );
    res.json({
      donations: result.rows.map(row => ({
        campaignId: row.campaign_id,
        campaignTitle: row.campaign_title,
        donorName: row.anonymous ? 'Anonymous donor' : (row.donor_name || 'DonateUZ supporter'),
        amountCents: Number(row.amount_cents),
        currency: row.currency,
        createdAt: row.created_at
      }))
    });
  } catch (err) {
    console.error('[donations] recent error', err);
    res.status(500).json({ error: 'Could not load recent donations.' });
  }
});

// Lets the success page show a receipt immediately, without waiting on the webhook.
router.get('/verify/:sessionId', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const local = await pool.query('SELECT * FROM donations WHERE stripe_session_id = $1', [sessionId]);
    let donation = local.rows[0];
    if (!donation) return res.status(404).json({ error: 'Donation not found.' });

    if (donation.status !== 'completed' && process.env.STRIPE_SECRET_KEY) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid' || session.status === 'complete') {
        const updated = await pool.query(
          `UPDATE donations SET status = 'completed', stripe_payment_intent = $1, stripe_subscription_id = $2,
             donor_email = COALESCE(donor_email, $3)
           WHERE stripe_session_id = $4 AND status <> 'completed' RETURNING *`,
          [session.payment_intent || null, session.subscription || null,
           (session.customer_details && session.customer_details.email) || session.customer_email || null, sessionId]
        );
        if (updated.rows[0]) {
          donation = updated.rows[0];
          sendDonationReceipt(donation.id, (session.customer_details && session.customer_details.email) || session.customer_email);
          notifyGoalReached(donation.campaign_id); // fire-and-forget, idempotent
        }
      }
    }

    res.json({ donation: serializeDonation(donation) });
  } catch (err) {
    console.error('[donations] verify error', err);
    res.status(500).json({ error: 'Could not verify donation.' });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM donations WHERE user_id = $1 AND status = 'completed' ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ donations: result.rows.map(serializeDonation) });
  } catch (err) {
    console.error('[donations] history error', err);
    res.status(500).json({ error: 'Could not load donation history.' });
  }
});

function serializeDonation(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignTitle: row.campaign_title,
    donorName: row.donor_name,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    anonymous: row.anonymous,
    recurring: row.recurring,
    status: row.status,
    createdAt: row.created_at
  };
}

module.exports = router;
