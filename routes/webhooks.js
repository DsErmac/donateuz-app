const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { sendDonationReceipt } = require('../services/receipts');
const { notifyGoalReached } = require('../services/goals');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

// Marks the donation completed (idempotent) and, outside the request's critical path,
// emails a receipt and checks whether the campaign just reached its goal.
async function completeDonation(session) {
  const email = (session.customer_details && session.customer_details.email) || session.customer_email || null;
  const result = await pool.query(
    `UPDATE donations
       SET status = 'completed', stripe_payment_intent = $1, stripe_subscription_id = $2,
           donor_email = COALESCE(donor_email, $3)
     WHERE stripe_session_id = $4 AND status <> 'completed'
     RETURNING id, campaign_id`,
    [session.payment_intent || null, session.subscription || null, email, session.id]
  );
  // Also covers the case where the success-page verify route completed it first.
  const row = result.rows[0] || (await pool.query('SELECT id, campaign_id FROM donations WHERE stripe_session_id = $1', [session.id])).rows[0];
  if (row) {
    sendDonationReceipt(row.id, email);
    notifyGoalReached(row.campaign_id); // fire-and-forget, idempotent
  }
}

// IMPORTANT: this route must receive the RAW request body (see server.js),
// because Stripe signs the exact byte stream, not the parsed JSON.
router.post('/', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Only mark paid when money was actually collected (delayed methods report 'unpaid' here).
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
          await completeDonation(session);
        }
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        await completeDonation(event.data.object);
        break;
      }

      // Monthly renewal payments for recurring donations. The first invoice
      // (billing_reason = subscription_create) is already covered by
      // checkout.session.completed above, so only log later cycles here.
      // stripe_invoice_id is UNIQUE, so a retried webhook cannot double-count a renewal.
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const meta = subscription.metadata || {};
          if (meta.campaignId) {
            // The campaign may have been deleted since the donor subscribed.
            // Recording nothing and returning 200 stops Stripe's retry loop —
            // the money was collected; only the attribution is gone.
            const campaignExists = await pool.query('SELECT 1 FROM campaigns WHERE id = $1', [meta.campaignId]);
            if (!campaignExists.rows[0]) {
              console.warn(`[webhook] renewal for deleted campaign ${meta.campaignId} — recorded nowhere, acknowledged`);
              break;
            }
            // Reach the guest donor's email via the Stripe customer for receipts/goal emails.
            let donorEmail = null;
            try {
              const customer = await stripe.customers.retrieve(invoice.customer);
              if (customer && !customer.deleted) donorEmail = customer.email || null;
            } catch (e) { /* email is optional on this path */ }
            await pool.query(
              `INSERT INTO donations
                (user_id, campaign_id, campaign_title, donor_name, donor_email, amount_cents, currency, anonymous, recurring, status, stripe_subscription_id, stripe_invoice_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,true,'completed',$8,$9,$10)
               ON CONFLICT (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL DO NOTHING`,
              [
                meta.userId || null,
                meta.campaignId,
                meta.campaignTitle || meta.campaignId,
                meta.donorName || 'DonateUZ supporter',
                meta.userId ? null : donorEmail,
                invoice.amount_paid,
                (invoice.currency || 'usd'),
                meta.anonymous === 'true',
                subscription.id,
                invoice.id
              ]
            );
            notifyGoalReached(meta.campaignId); // fire-and-forget, idempotent
          }
        }
        break;
      }

      // Abandoned or failed checkouts should not sit in 'pending' forever.
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        await pool.query(
          `UPDATE donations SET status = 'failed' WHERE stripe_session_id = $1 AND status = 'pending'`,
          [session.id]
        );
        break;
      }

      // A failed renewal doesn't create a donation row (nothing was collected), so just log it.
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.warn('[webhook] renewal payment failed for subscription', invoice.subscription);
        break;
      }

      // Donor cancelled (or Stripe cancelled after repeated failures): keep a trace for the admin.
      case 'customer.subscription.deleted': {
        console.log('[webhook] monthly donation cancelled:', event.data.object.id);
        break;
      }

      default:
        // Unhandled event types are fine to ignore.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[webhook] handler error', err);
    // Returning 500 makes Stripe retry the event, which is what we want here.
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

module.exports = router;
