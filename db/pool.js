const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set. Copy .env.example to .env and fill in your Neon connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon requires TLS and presents a publicly trusted certificate, so verification can stay ON.
  ssl: true,
  // Pool sizing: keep a handful of idle connections warm and never exceed
  // the database host's limit. Idle clients are reaped after 10s so leaked
  // connections don't linger forever (each idle client costs ~8MB RAM).
  max: 25,
  idleTimeoutMillis: 10000,
  // Neon suspends idle computes; a cold start can take several seconds,
  // so allow the first connection after an idle period to wait.
  connectionTimeoutMillis: 15000,
  maxUses: 7500 // ~1 day per connection (5000 max / 12s avg checkouts) before recycle
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

// Neon's endpoint doesn't accept TCP while a suspended compute is waking, so
// the first connection attempt after an idle period often fails even though
// that attempt is what wakes the compute. Retrying once gives it time to come
// up — without this, the first visitor after a pause sees a broken homepage.
const CONNECTION_ERROR_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'ENOTFOUND',
  '08006', // connection failure
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '57P03'  // cannot connect now
]);

function isConnectionError(err) {
  return !!(err && (CONNECTION_ERROR_CODES.has(err.code) || err.errors)); // AggregateError from multi-address connect
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withConnectionRetry(fn, attempts = 2) {
  try {
    return await fn();
  } catch (err) {
    if (attempts > 0 && isConnectionError(err)) {
      await sleep(1000);
      return withConnectionRetry(fn, attempts - 1);
    }
    throw err;
  }
}

// Same surface as the raw Pool (pool.query / pool.connect / pool.end / pool.on),
// with transparent connection retries on top.
module.exports = {
  query: (...args) => withConnectionRetry(() => pool.query(...args)),
  connect: (...args) => withConnectionRetry(() => pool.connect(...args)),
  end: (...args) => pool.end(...args),
  on: (...args) => pool.on(...args)
};
