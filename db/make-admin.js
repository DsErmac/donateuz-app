// Usage: npm run make-admin -- someone@example.com
require('dotenv').config();
const pool = require('./pool');

(async () => {
  const email = (process.argv[2] || '').toLowerCase();
  if (!email) { console.error('Usage: npm run make-admin -- <email>'); process.exit(1); }
  const result = await pool.query("UPDATE users SET role = 'admin' WHERE lower(email) = $1 RETURNING email", [email]);
  console.log(result.rows[0] ? `✓ ${result.rows[0].email} is now an admin.` : `No user found with email ${email}. Register that account first.`);
  await pool.end();
})().catch(err => { console.error(err); process.exit(1); });
