const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// If TURSO_DATABASE_URL is set, this connects to your free hosted Turso
// database (persists forever, survives restarts/redeploys).
// If not set, it falls back to a local file — handy for testing on your
// own computer before you deploy anywhere.
const usingTurso = !!process.env.TURSO_DATABASE_URL;
const localPath = path.join(__dirname, 'data', 'billbook.db');
if (!usingTurso) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

const client = createClient(
  usingTurso
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${localPath}` }
);

async function run(sql, args = {}) {
  return client.execute({ sql, args });
}
async function get(sql, args = {}) {
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}
async function all(sql, args = {}) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function initSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      passHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      lastView TEXT NOT NULL DEFAULT 'dashboard',
      createdAt TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'My company',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      taxId TEXT DEFAULT '',
      currency TEXT DEFAULT '₹',
      defaultTax REAL DEFAULT 0,
      prefix TEXT DEFAULT 'INV-',
      nextInvoiceSeq INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      taxId TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      price REAL DEFAULT 0,
      tax REAL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      date TEXT NOT NULL,
      dueDate TEXT DEFAULT '',
      customerId TEXT,
      status TEXT DEFAULT 'draft',
      notes TEXT DEFAULT '',
      items TEXT NOT NULL,
      discount REAL DEFAULT 0
    )`
  ];
  for (const sql of statements) {
    await client.execute(sql);
  }
  const companyRow = await get('SELECT * FROM company WHERE id = 1');
  if (!companyRow) {
    await run(`INSERT INTO company (id, name) VALUES (1, 'My company')`);
  }
}

module.exports = { run, get, all, initSchema, client, usingTurso };
