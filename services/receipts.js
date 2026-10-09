const pool = require('../db/pool');
const { sendEmail, escapeHtml, layout } = require('./email');

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(Number(cents) / 100);
  } catch (e) {
    return `${(Number(cents) / 100).toFixed(2)} ${currency}`;
  }
}

// Sends a thank-you receipt at most once per donation. Safe to call from both the Stripe webhook
// and the success-page verify route: whichever claims receipt_sent_at first does the sending.
async function sendDonationReceipt(donationId, fallbackEmail) {
  if (!process.env.RESEND_API_KEY) return; // email not configured: leave the donation unclaimed
  try {
    const claimed = await pool.query(
      `UPDATE donations SET receipt_sent_at = now()
       WHERE id = $1 AND status = 'completed' AND receipt_sent_at IS NULL
       RETURNING *`,
      [donationId]
    );
    const donation = claimed.rows[0];
    if (!donation) return;

    let to = fallbackEmail || null; // Stripe's customer email works for guests too
    if (donation.user_id) {
      const u = await pool.query('SELECT email FROM users WHERE id = $1', [donation.user_id]);
      if (u.rows[0]) to = u.rows[0].email;
    }

    const amount = formatMoney(donation.amount_cents, donation.currency);
    const frequency = donation.recurring ? 'Monthly' : 'One-time';
    const html = layout('Thank you for your donation', `
      <p>Your gift makes a real difference.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b7a72">Campaign</td><td style="text-align:right"><strong>${escapeHtml(donation.campaign_title)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7a72">Amount</td><td style="text-align:right"><strong>${escapeHtml(amount)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7a72">Frequency</td><td style="text-align:right">${frequency}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7a72">Reference</td><td style="text-align:right;font-size:12px">${escapeHtml(donation.id)}</td></tr>
      </table>
      ${donation.recurring ? '<p style="font-size:13px">You will be charged monthly until you cancel.</p>' : ''}`);
    const text = `Thank you for your donation!\n\nCampaign: ${donation.campaign_title}\nAmount: ${amount}\nFrequency: ${frequency}\nReference: ${donation.id}\n`;

    const sent = await sendEmail({ to, subject: `Your DonateUZ receipt — ${amount}`, html, text });
    if (!sent && to && process.env.RESEND_API_KEY) {
      // Release the claim so a later call (e.g. webhook retry) can try again.
      await pool.query('UPDATE donations SET receipt_sent_at = NULL WHERE id = $1', [donationId]);
    }
  } catch (err) {
    console.error('[receipt] error', err.message);
  }
}

module.exports = { sendDonationReceipt };
