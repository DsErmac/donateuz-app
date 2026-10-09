// Minimal transactional email via Resend's HTTP API (no extra dependency; uses Node's built-in fetch).
// Never throws: a failed email must not break a payment or an admin action.

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function sendEmail({ to, subject, html, text }) {
  if (!to) return false;
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — skipped "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'DonateUZ <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
        text
      })
    });
    if (!res.ok) {
      console.error('[email] send failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send error', err.message);
    return false;
  }
}

function layout(title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#14201a">
  <h2 style="margin:0 0 16px;color:#0b7a4b">DonateUZ</h2>
  <h3 style="margin:0 0 12px">${escapeHtml(title)}</h3>
  ${bodyHtml}
  <p style="margin-top:28px;font-size:12px;color:#6b7a72">You received this because of activity on DonateUZ.</p>
</div>`;
}

module.exports = { sendEmail, escapeHtml, layout };
