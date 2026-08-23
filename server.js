const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-real-use-billbook';

function uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

// Slows down anyone guessing usernames/passwords. This app is reachable on
// the internet (that's what makes multi-device sync possible), so this is
// the main defense against strangers brute-forcing their way in — the real
// gate is still that they need a valid username + password you created.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get('SELECT * FROM users WHERE id = :id', { id: payload.id });
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin account required' });
  next();
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
}

/* ---------- AUTH ---------- */

app.get('/api/setup-status', asyncRoute(async (req, res) => {
  const row = await db.get('SELECT COUNT(*) AS c FROM users');
  res.json({ needsSetup: Number(row.c) === 0 });
}));

app.post('/api/setup', loginLimiter, asyncRoute(async (req, res) => {
  const row = await db.get('SELECT COUNT(*) AS c FROM users');
  if (Number(row.c) > 0) return res.status(400).json({ error: 'Setup already completed' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: 'Enter a username and a password of at least 4 characters' });
  }
  const passHash = bcrypt.hashSync(password, 10);
  const user = { id: uid(), username: username.trim(), passHash, role: 'admin', lastView: 'dashboard', createdAt: new Date().toISOString() };
  await db.run('INSERT INTO users (id, username, passHash, role, lastView, createdAt) VALUES (:id,:username,:passHash,:role,:lastView,:createdAt)', user);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, lastView: user.lastView } });
}));

app.post('/api/login', loginLimiter, asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE lower(username) = lower(:username)', { username: (username || '').trim() });
  if (!user) return res.status(401).json({ error: 'No account with that username' });
  if (!bcrypt.compareSync(password || '', user.passHash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, lastView: user.lastView } });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, lastView: req.user.lastView });
}));

app.put('/api/me/last-view', auth, asyncRoute(async (req, res) => {
  const { view } = req.body || {};
  const allowed = ['dashboard', 'invoices', 'customers', 'products', 'settings'];
  if (!allowed.includes(view)) return res.status(400).json({ error: 'Invalid view' });
  await db.run('UPDATE users SET lastView = :view WHERE id = :id', { view, id: req.user.id });
  res.json({ ok: true });
}));

app.put('/api/me/password', auth, asyncRoute(async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password should be at least 4 characters' });
  await db.run('UPDATE users SET passHash = :passHash WHERE id = :id', { passHash: bcrypt.hashSync(password, 10), id: req.user.id });
  res.json({ ok: true });
}));

/* ---------- TEAM (admin only) ---------- */

app.get('/api/users', auth, requireAdmin, asyncRoute(async (req, res) => {
  const rows = await db.all('SELECT id, username, role FROM users');
  res.json(rows);
}));

app.post('/api/users', auth, requireAdmin, asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: 'Enter a username and a password of at least 4 characters' });
  }
  const existing = await db.get('SELECT id FROM users WHERE lower(username) = lower(:username)', { username: username.trim() });
  if (existing) return res.status(400).json({ error: 'That username is already taken' });
  const user = { id: uid(), username: username.trim(), passHash: bcrypt.hashSync(password, 10), role: 'staff', lastView: 'dashboard', createdAt: new Date().toISOString() };
  await db.run('INSERT INTO users (id, username, passHash, role, lastView, createdAt) VALUES (:id,:username,:passHash,:role,:lastView,:createdAt)', user);
  res.json({ id: user.id, username: user.username, role: user.role });
}));

app.delete('/api/users/:id', auth, requireAdmin, asyncRoute(async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = :id', { id: req.params.id });
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Cannot remove the admin account' });
  await db.run('DELETE FROM users WHERE id = :id', { id: req.params.id });
  res.json({ ok: true });
}));

/* ---------- COMPANY ---------- */

app.put('/api/company', auth, requireAdmin, asyncRoute(async (req, res) => {
  const c = req.body || {};
  await db.run(
    `UPDATE company SET name=:name, email=:email, phone=:phone, address=:address, taxId=:taxId, currency=:currency, defaultTax=:defaultTax, prefix=:prefix WHERE id=1`,
    {
      name: c.name || 'My company', email: c.email || '', phone: c.phone || '', address: c.address || '',
      taxId: c.taxId || '', currency: c.currency || '₹', defaultTax: Number(c.defaultTax) || 0, prefix: c.prefix || 'INV-'
    }
  );
  res.json({ ok: true });
}));

/* ---------- CUSTOMERS ---------- */

app.post('/api/customers', auth, asyncRoute(async (req, res) => {
  const c = req.body || {};
  if (!c.name || !c.name.trim()) return res.status(400).json({ error: 'Customer name is required' });
  const row = { id: uid(), name: c.name.trim(), email: c.email || '', phone: c.phone || '', address: c.address || '', taxId: c.taxId || '' };
  await db.run('INSERT INTO customers (id,name,email,phone,address,taxId) VALUES (:id,:name,:email,:phone,:address,:taxId)', row);
  res.json(row);
}));

app.put('/api/customers/:id', auth, asyncRoute(async (req, res) => {
  const c = req.body || {};
  if (!c.name || !c.name.trim()) return res.status(400).json({ error: 'Customer name is required' });
  await db.run('UPDATE customers SET name=:name, email=:email, phone=:phone, address=:address, taxId=:taxId WHERE id=:id', {
    id: req.params.id, name: c.name.trim(), email: c.email || '', phone: c.phone || '', address: c.address || '', taxId: c.taxId || ''
  });
  res.json({ ok: true });
}));

app.delete('/api/customers/:id', auth, asyncRoute(async (req, res) => {
  await db.run('DELETE FROM customers WHERE id = :id', { id: req.params.id });
  res.json({ ok: true });
}));

/* ---------- PRODUCTS ---------- */

app.post('/api/products', auth, asyncRoute(async (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.name.trim()) return res.status(400).json({ error: 'Item name is required' });
  const row = { id: uid(), name: p.name.trim(), unit: p.unit || '', price: Number(p.price) || 0, tax: Number(p.tax) || 0 };
  await db.run('INSERT INTO products (id,name,unit,price,tax) VALUES (:id,:name,:unit,:price,:tax)', row);
  res.json(row);
}));

app.put('/api/products/:id', auth, asyncRoute(async (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.name.trim()) return res.status(400).json({ error: 'Item name is required' });
  await db.run('UPDATE products SET name=:name, unit=:unit, price=:price, tax=:tax WHERE id=:id', {
    id: req.params.id, name: p.name.trim(), unit: p.unit || '', price: Number(p.price) || 0, tax: Number(p.tax) || 0
  });
  res.json({ ok: true });
}));

app.delete('/api/products/:id', auth, asyncRoute(async (req, res) => {
  await db.run('DELETE FROM products WHERE id = :id', { id: req.params.id });
  res.json({ ok: true });
}));

/* ---------- INVOICES ---------- */

app.post('/api/invoices', auth, asyncRoute(async (req, res) => {
  const i = req.body || {};
  if (!i.customerId) return res.status(400).json({ error: 'Choose a customer' });
  if (!Array.isArray(i.items) || i.items.length === 0) return res.status(400).json({ error: 'Add at least one line item' });

  const company = await db.get('SELECT * FROM company WHERE id = 1');
  let number = i.number && i.number.trim();
  if (!number) {
    number = (company.prefix || 'INV-') + String(company.nextInvoiceSeq).padStart(4, '0');
    await db.run('UPDATE company SET nextInvoiceSeq = nextInvoiceSeq + 1 WHERE id = 1');
  }
  const row = {
    id: uid(), number, date: i.date || new Date().toISOString().slice(0, 10), dueDate: i.dueDate || '',
    customerId: i.customerId, status: i.status || 'draft', notes: i.notes || '',
    items: JSON.stringify(i.items), discount: Number(i.discount) || 0
  };
  await db.run('INSERT INTO invoices (id,number,date,dueDate,customerId,status,notes,items,discount) VALUES (:id,:number,:date,:dueDate,:customerId,:status,:notes,:items,:discount)', row);
  res.json({ ...row, items: i.items });
}));

app.put('/api/invoices/:id', auth, asyncRoute(async (req, res) => {
  const i = req.body || {};
  if (!i.customerId) return res.status(400).json({ error: 'Choose a customer' });
  if (!Array.isArray(i.items) || i.items.length === 0) return res.status(400).json({ error: 'Add at least one line item' });
  await db.run('UPDATE invoices SET number=:number, date=:date, dueDate=:dueDate, customerId=:customerId, status=:status, notes=:notes, items=:items, discount=:discount WHERE id=:id', {
    id: req.params.id, number: i.number, date: i.date, dueDate: i.dueDate || '', customerId: i.customerId,
    status: i.status || 'draft', notes: i.notes || '', items: JSON.stringify(i.items), discount: Number(i.discount) || 0
  });
  res.json({ ok: true });
}));

app.delete('/api/invoices/:id', auth, asyncRoute(async (req, res) => {
  await db.run('DELETE FROM invoices WHERE id = :id', { id: req.params.id });
  res.json({ ok: true });
}));

/* ---------- BULK LOAD ---------- */

app.get('/api/all', auth, asyncRoute(async (req, res) => {
  const company = await db.get('SELECT * FROM company WHERE id = 1');
  const customers = await db.all('SELECT * FROM customers');
  const products = await db.all('SELECT * FROM products');
  const invoiceRows = await db.all('SELECT * FROM invoices');
  const invoices = invoiceRows.map(inv => ({ ...inv, items: JSON.parse(inv.items) }));
  const payload = {
    company, customers, products, invoices,
    me: { id: req.user.id, username: req.user.username, role: req.user.role, lastView: req.user.lastView }
  };
  if (req.user.role === 'admin') {
    payload.users = await db.all('SELECT id, username, role FROM users');
  }
  res.json(payload);
}));

/* ---------- BACKUP / RESET (admin only) ---------- */

app.get('/api/backup', auth, requireAdmin, asyncRoute(async (req, res) => {
  const company = await db.get('SELECT * FROM company WHERE id = 1');
  const customers = await db.all('SELECT * FROM customers');
  const products = await db.all('SELECT * FROM products');
  const invoiceRows = await db.all('SELECT * FROM invoices');
  const invoices = invoiceRows.map(inv => ({ ...inv, items: JSON.parse(inv.items) }));
  res.json({ company, customers, products, invoices, exportedAt: new Date().toISOString() });
}));

app.post('/api/restore', auth, requireAdmin, asyncRoute(async (req, res) => {
  const data = req.body || {};
  if (!Array.isArray(data.invoices)) return res.status(400).json({ error: 'That file does not look like a valid backup' });

  await db.run('DELETE FROM customers');
  await db.run('DELETE FROM products');
  await db.run('DELETE FROM invoices');
  for (const c of (data.customers || [])) {
    await db.run('INSERT INTO customers (id,name,email,phone,address,taxId) VALUES (:id,:name,:email,:phone,:address,:taxId)', c);
  }
  for (const p of (data.products || [])) {
    await db.run('INSERT INTO products (id,name,unit,price,tax) VALUES (:id,:name,:unit,:price,:tax)', p);
  }
  for (const i of (data.invoices || [])) {
    await db.run('INSERT INTO invoices (id,number,date,dueDate,customerId,status,notes,items,discount) VALUES (:id,:number,:date,:dueDate,:customerId,:status,:notes,:items,:discount)', { ...i, items: JSON.stringify(i.items) });
  }
  if (data.company) {
    await db.run('UPDATE company SET name=:name,email=:email,phone=:phone,address=:address,taxId=:taxId,currency=:currency,defaultTax=:defaultTax,prefix=:prefix,nextInvoiceSeq=:nextInvoiceSeq WHERE id=1', {
      name: data.company.name || 'My company', email: data.company.email || '', phone: data.company.phone || '',
      address: data.company.address || '', taxId: data.company.taxId || '', currency: data.company.currency || '₹',
      defaultTax: Number(data.company.defaultTax) || 0, prefix: data.company.prefix || 'INV-',
      nextInvoiceSeq: Number(data.company.nextInvoiceSeq) || 1
    });
  }
  res.json({ ok: true });
}));

app.post('/api/reset', auth, requireAdmin, asyncRoute(async (req, res) => {
  await db.run('DELETE FROM customers');
  await db.run('DELETE FROM products');
  await db.run('DELETE FROM invoices');
  await db.run('UPDATE company SET nextInvoiceSeq = 1 WHERE id = 1');
  res.json({ ok: true });
}));

app.use(express.static(require('path').join(__dirname, 'public')));

(async () => {
  await db.initSchema();
  app.listen(PORT, () => {
    console.log(`Bill book server running on port ${PORT} (database: ${db.usingTurso ? 'Turso (hosted)' : 'local file'})`);
  });
})();
