require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const webhookRoutes = require('./routes/webhooks');
const authRoutes = require('./routes/auth');
const campaignRoutes = require('./routes/campaigns');
const donationRoutes = require('./routes/donations');
const supportRoutes = require('./routes/support');
const adminRoutes = require('./routes/admin');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a proxy (Render, Railway, Fly...) so rate limiting sees the real client IP.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// --- Security headers. The CSP allows the CDNs/fonts/photos the frontend uses.
// 'unsafe-inline' for scripts is needed while the HTML uses inline onclick handlers and the
// Tailwind play-CDN; removing those would let you tighten this further.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // Only force https in production; it breaks plain-http localhost in some browsers.
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  }
}));

// --- Stripe webhook: must come BEFORE express.json(), Stripe needs the raw body to verify its signature.
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), webhookRoutes);

// --- Everything else uses normal JSON body parsing (small limit: nothing here needs big payloads).
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

// --- Rate limits
const limiter = (windowMinutes, max, message) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message }
});
const authLimiter = limiter(15, 20, 'Too many attempts. Please wait a few minutes and try again.');
const checkoutLimiter = limiter(10, 30, 'Too many checkout attempts. Please wait a few minutes.');
const supportLimiter = limiter(60, 10, 'Too many requests submitted. Please try again later.');

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/donations/checkout', checkoutLimiter);
app.post('/api/support-requests', supportLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/support-requests', supportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Unknown API routes should be JSON 404s, not the HTML page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// --- Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DonateUZ server running at http://localhost:${PORT}`);
  if (!process.env.STRIPE_SECRET_KEY) console.warn('⚠ STRIPE_SECRET_KEY is not set — donations will fail until you add it to .env');
  if (!process.env.DATABASE_URL) console.warn('⚠ DATABASE_URL is not set — auth/campaigns/donations will fail until you add it to .env');
});
