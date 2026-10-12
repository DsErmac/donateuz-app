# DonateUZ — with real auth (Neon Postgres) and real payments (Stripe)

DonateUZ is all about giving with purpose in Uzbekistan. Whether you want to help with a medical emergency, support a student, or give back to your community, this app connects your generosity directly with verified local causes. Donate securely via Click or Payme and track your real-world impact.


This is a Node/Express backend + static frontend. It replaces the old browser-only
localStorage mock with:

- **Auth**: email/password accounts stored in Neon Postgres, sessions via an httpOnly JWT cookie.
- **Payments**: real Stripe Checkout sessions (test mode by default). Stripe's webhook is the
  source of truth for marking a donation "completed" — the frontend never marks its own payment successful.
- **Campaigns & donations**: stored in Neon, not localStorage. Campaign progress bars are computed
  live from real completed donations.
- **Saved campaigns**: bookmarks sync to the account (`saved_campaigns` table) so they follow the
  donor across devices; guest bookmarks live in localStorage and merge into the account on sign-in.
- **Deep links**: every view has a URL (`#donate`, `#settings`, ...) and any campaign is shareable
  as `#campaign/<id>`, with a share button on the campaign sheet (native share on mobile,
  clipboard fallback).
- **Email**: donation receipts (at most once per donation) and "goal reached" notifications to
  every donor of a campaign when it first crosses its funding goal — both idempotent, both
  safe to retry.
- **Frontend**: single-page app with a visual identity drawn from Uzbek tilework and suzani
  embroidery (cobalt/turquoise/terracotta, Fraunces + Figtree), self-hosted hero and story
  videos, scroll-reveal and count-up animations, dark mode, and a reduce-motion setting.
  No CSS framework runtime — a small static utility layer in `styles.css` replaced the
  Tailwind CDN. The offline page loads zero external resources.

## 1. Create a Neon database

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the **pooled connection string** from the dashboard (Connection Details).
3. Paste it into `.env` as `DATABASE_URL` (see step 3 below).

## 2. Create a Stripe account (test mode)

1. Sign up at [stripe.com](https://stripe.com).
2. Dashboard → **Developers → API keys** → copy the **Secret key** (`sk_test_...`) and
   **Publishable key** (`pk_test_...`).
3. Stripe only supports certain settlement currencies per account/country — this project
   defaults to **USD** (`STRIPE_CURRENCY=usd`) so it works everywhere in test mode. Change it
   in `.env` only if your Stripe account supports another currency you want to use.

## 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `JWT_SECRET` (any long random string — `openssl rand -base64 48`),
`STRIPE_SECRET_KEY`, and `STRIPE_PUBLISHABLE_KEY`. Leave `STRIPE_WEBHOOK_SECRET` for step 5.

## 4. Install dependencies and create the database tables

```bash
npm install
npm run db:migrate
```

`db:migrate` runs `db/schema.sql` against your Neon database — creates the `users`,
`campaigns`, `donations`, `support_requests`, and `saved_campaigns` tables (plus the
`goal_reached_at` / `donor_email` columns used by goal-reached emails), and seeds the four
demo campaigns. Safe to run again later; it won't duplicate the seed data.

## 5. Forward Stripe webhooks to your machine (local development)

Donations are only marked "completed" once Stripe's webhook fires — this is what keeps a
user from being able to fake a successful payment by just calling your API. For local dev,
use the [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe login
npm run stripe:listen
```

This prints a `whsec_...` value — put that in `.env` as `STRIPE_WEBHOOK_SECRET`, then restart
the server. Keep `stripe listen` running in a separate terminal while you test donations.

## 6. Run it

```bash
npm run dev
```

Visit **http://localhost:3000**. Create an account, browse to Donate, and check out with
Stripe's test card:

```
Card number: 4242 4242 4242 4242
Expiry: any future date · CVC: any 3 digits · ZIP: any 5 digits
```

After paying, Stripe redirects back to the app, the webhook marks the donation completed in
Neon, and it shows up under Profile → Donation History.

## 7. Admin review and email (optional but recommended)

- **Review queue:** sign in as an admin (see `npm run make-admin` below), open Profile → *Admin Review Panel*.
  *Approve & publish* turns a support request into a live campaign (with a generated, URL-safe id);
  *Reject* lets you add a note. Both actions are recorded (`reviewed_by`, `reviewed_at`) and the
  requester is emailed if they were signed in.
- **Email:** receipts for completed donations and review outcomes are sent through
  [Resend](https://resend.com). Set `RESEND_API_KEY` and `EMAIL_FROM` in `.env`. Without a key, emails are
  skipped and logged. With Resend's test sender you can only deliver to your own account email; verify a
  domain for real delivery. A receipt is sent at most once per donation. When a campaign first
  crosses its goal, every distinct donor is emailed once (registered users via account email,
  guests via the email stored from the Stripe session in `donations.donor_email`); the
  `goal_reached_at` timestamp on the campaign makes retries safe.
- Re-run `npm run db:migrate` after updating to add the new columns.

## Project structure

```
server.js                Express app; mounts routes (webhook route MUST stay before express.json())
db/schema.sql             Table definitions + seed campaigns (idempotent ALTERs for later columns)
db/migrate.js             Runs schema.sql against DATABASE_URL
db/make-admin.js          npm run make-admin -- <email>  (grants the admin role)
db/pool.js                pg connection pool
middleware/auth.js        JWT cookie helpers + requireAuth / optionalAuth / requireAdmin
routes/auth.js             POST /api/auth/register, /login, /logout · GET /me
routes/campaigns.js        GET /api/campaigns (live totals from completed donations)
routes/donations.js        POST /api/donations/checkout · GET /recent · GET /verify/:id · GET /history
routes/saved.js            GET /api/saved · PUT/DELETE /api/saved/:campaignId — account-synced bookmarks
routes/stats.js            GET /api/stats — anonymous platform totals for the home page
routes/support.js          POST /api/support-requests · GET / (admin queue) · POST /:id/approve · POST /:id/reject
routes/admin.js            Admin dashboard API: stats, campaign CRUD, donation refund/cancel, user roles
routes/webhooks.js         POST /api/webhooks/stripe — source of truth for payment status + goal notifications
services/email.js          Resend wrapper (never throws)
services/receipts.js       Donation receipt email, sent at most once per donation
services/goals.js          "Goal reached" donor emails, idempotent via campaigns.goal_reached_at
public/                    Frontend (index.html, styles.css, script.js) + PWA (manifest.json, sw.js, offline.html)
public/videos/             Self-hosted hero + story videos (served same-origin; CSP media-src is 'self')
```

## Going to production — things this demo intentionally simplifies

- **Admin access**: `GET /api/support-requests` now requires `users.role = 'admin'` (checked in the
  database on every request). Re-run `npm run db:migrate` to add the column, register an account,
  then promote it: `npm run make-admin -- you@example.com`.
- **Webhook endpoint**: in production, register `https://yourdomain.com/api/webhooks/stripe`
  in the Stripe Dashboard (Developers → Webhooks) instead of using the CLI, and put that
  webhook's signing secret in `STRIPE_WEBHOOK_SECRET`.
- **Cookies**: `secure: true` on the auth cookie is already gated on `NODE_ENV=production` —
  make sure you actually set that env var and serve over HTTPS.
- **Rate limiting** (login/register/checkout/support) and security headers (helmet) are in place.
  **Email verification / password reset** aren't implemented yet — add them before handling real users.
- **File uploads** for support-request documents aren't implemented (the UI has a file input,
  but nothing persists it) — wire up S3/Cloudinary/etc. before relying on it.
- **Recurring donations**: monthly renewal payments are logged via the `invoice.paid` webhook
  event. Test this with `stripe trigger invoice.paid` or by using Stripe's test clocks.
- **Managed Payments**: newer Stripe accounts have Managed Payments on by default, which only
  covers digital products — it rejects donations. Checkout opts out per session with
  `managed_payments: { enabled: false }` in `routes/donations.js`; don't remove that flag or
  checkout will fail with "the product tax code is missing" on such accounts.

## 8. Admin Dashboard

Sign in as an admin and you get an **Admin** button in the bottom nav (plus Profile → Admin Review
Panel for the support-request queue). The dashboard has five tabs:

- **Overview** — live platform totals (raised, gifts, monthly donors, users, pending requests).
- **Campaigns** — create, edit, close/reopen and delete campaigns (delete is blocked once a
  campaign has completed donations), with search and status filters.
- **Donations** — every donation with donor info, status filters, CSV export, and real money
  actions: **Refund** a completed one-time gift via Stripe, or **Cancel monthly** to stop future
  renewals (the donor keeps the current cycle).
- **Users** — promote to admin / demote back to user (you can't change your own role), CSV export.
- **Support** — the review queue with the request story inline; approve publishes a campaign,
  reject can carry a reviewer note that is emailed to the requester.

Everything on the dashboard is fetched through `/api/admin/*`, which re-checks
`users.role = 'admin'` in the database on every request.

## Security notes

- `JWT_SECRET` must be at least 32 characters or the server refuses to start.
- All user-supplied text rendered through `innerHTML` in `public/script.js` goes through `esc()`.
  Keep doing that for any new template. Campaign `id`s are also placed in inline `onclick` handlers,
  so keep them to `[a-z0-9-]` when you build campaign creation.
- Webhook handling is idempotent: renewal donations are keyed on `stripe_invoice_id` (UNIQUE).
- The Content-Security-Policy still allows inline scripts because the HTML uses inline `onclick`
  handlers (the Tailwind CDN was replaced by a small utility layer in `styles.css`).
  Moving to `addEventListener` would let you remove `'unsafe-inline'`.