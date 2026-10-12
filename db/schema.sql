-- DonateUZ database schema (Neon Postgres)
-- Run with: npm run db:migrate

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Users ----------
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Campaigns ----------
CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  region text NOT NULL,
  story text NOT NULL,
  image_seed text NOT NULL,
  goal_amount_cents bigint NOT NULL,
  seed_raised_amount_cents bigint NOT NULL DEFAULT 0,
  urgency int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'active', -- active | closed
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Donations ----------
CREATE TABLE IF NOT EXISTS donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_title text NOT NULL,
  donor_name text,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  anonymous boolean NOT NULL DEFAULT false,
  recurring boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending', -- pending | completed | failed
  stripe_session_id text UNIQUE,
  stripe_payment_intent text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donations_user ON donations(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_campaign ON donations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_donations_session ON donations(stripe_session_id);

-- ---------- Support requests ("Request support" tab / admin review) ----------
CREATE TABLE IF NOT EXISTS support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  category text NOT NULL,
  region text NOT NULL,
  target_amount_cents bigint NOT NULL,
  story text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review', -- pending_review | approved | rejected
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Security / integrity upgrades (safe to re-run) ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'; -- user | admin
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- One row per Stripe invoice: makes webhook retries idempotent for recurring donations.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS stripe_invoice_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_invoice ON donations (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_donations_subscription ON donations (stripe_subscription_id);

-- Admin review trail for support requests, and link to the campaign created on approval.
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL;

-- Set once a receipt email has been claimed, so the webhook and the success page never both send one.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_sent_at timestamptz;

-- ---------- Saved / bookmarked campaigns (per account, synced across devices) ----------
CREATE TABLE IF NOT EXISTS saved_campaigns (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, campaign_id)
);

-- ---------- Goal-reached notifications ----------
-- Set once (atomically) when a campaign first crosses its goal; donors are
-- emailed at that moment. Also lets the UI show "goal reached" state.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS goal_reached_at timestamptz;

-- Guest donors have no account, so their receipt email (from the Stripe session)
-- is stored here to make goal-reached notifications reachable for them too.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_email text;

-- ---------- Password reset ----------
-- Only the SHA-256 hash of each token is stored; the raw token lives solely in
-- the emailed link. One-time use, 1-hour expiry.
CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- ---------- Seed campaigns (safe to re-run) ----------
INSERT INTO campaigns (id, title, category, region, story, image_seed, goal_amount_cents, seed_raised_amount_cents, urgency)
VALUES
  ('medical', 'Urgent surgery for Dilnoza', 'Medical', 'Tashkent',
   'Dilnoza requires time-sensitive surgery and medical rehabilitation. Every contribution supports necessary medical care.',
   'donateuz-medical', 270000, 184000, 1),
  ('food', 'Warm meals for 120 families', 'Food', 'Samarkand',
   'Volunteers are preparing warm meal boxes and essential provisions for vulnerable local families.',
   'donateuz-food', 110000, 84000, 2),
  ('education', 'Desks and books for young learners', 'Education', 'Andijan',
   'Providing essential classroom desks, textbooks, and learning supplies for primary school students.',
   'donateuz-education', 245000, 126000, 3),
  ('relief', 'Rebuild homes after flooding', 'Relief', 'Fergana',
   'Helping families rebuild damaged roofs and restore essential living spaces following recent regional flooding.',
   'donateuz-relief', 150000, 51000, 4)
ON CONFLICT (id) DO NOTHING;
