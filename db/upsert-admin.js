// Securely creates or refreshes an admin account from a single JSON object on stdin.
// Expected input: { "name": "...", "email": "...", "password": "..." }
// Credentials are deliberately never accepted as command-line arguments or printed.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    // Raw mode prevents a terminal from echoing the JSON (and password) while
    // still allowing this utility to be driven interactively or by automation.
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(true);
    process.stdin.on('data', chunk => {
      if (chunk === '\u0003') return reject(new Error('Cancelled.'));
      input += chunk;
      const newline = input.search(/[\r\n]/);
      if (newline !== -1) {
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(input.slice(0, newline));
      }
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

(async () => {
  const raw = await readStdin();
  const { name, email, password } = JSON.parse(raw || '{}');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('A valid name is required.');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('A valid email is required.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new Error('Password must be 8–72 characters.');

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, lower($2), $3, 'admin')
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = 'admin',
           token_version = users.token_version + 1
     RETURNING email, role`,
    [name.trim(), email.trim(), passwordHash]
  );
  console.log(`Admin account ready: ${result.rows[0].email}`);
  await pool.end();
})().catch(async err => {
  console.error(`Could not prepare admin account: ${err.message}`);
  try { await pool.end(); } catch (_) { /* ignore close errors */ }
  process.exit(1);
});
