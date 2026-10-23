import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import express from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "forma-data"));
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(dataDir, "uploads"));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const sessionSecret = process.env.SESSION_SECRET || "";
if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random value at least 32 characters long. Copy .env.example to .env and configure it.");
}
if (sessionSecret.startsWith("replace-with-")) throw new Error("Replace the example SESSION_SECRET with a newly generated random value.");
if (process.env.NODE_ENV === "production" && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be configured before starting in production.");
}
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters long.");
}
if (process.env.ADMIN_PASSWORD?.startsWith("replace-with-") || process.env.ADMIN_EMAIL === "owner@example.com") {
  throw new Error("Replace the example owner email and password with your own credentials.");
}

const db = new Database(path.join(dataDir, "forma.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'admin')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    image TEXT NOT NULL,
    price REAL NOT NULL CHECK(price > 0),
    promo_price REAL CHECK(promo_price IS NULL OR (promo_price > 0 AND promo_price < price)),
    badge TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    currency TEXT NOT NULL DEFAULT 'USD',
    bank_name TEXT NOT NULL DEFAULT '',
    account_name TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL DEFAULT '',
    payment_instructions TEXT NOT NULL DEFAULT '',
    shipping_fee REAL NOT NULL DEFAULT 5.95 CHECK(shipping_fee >= 0),
    free_shipping_threshold REAL NOT NULL DEFAULT 75 CHECK(free_shipping_threshold >= 0),
    store_name TEXT NOT NULL DEFAULT 'Forma'
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    subtotal REAL NOT NULL,
    shipping REAL NOT NULL,
    total REAL NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Awaiting payment',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cart_items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
    PRIMARY KEY (user_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
  CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
`);
db.prepare("INSERT OR IGNORE INTO settings (id) VALUES (1)").run();

const seedProducts = [
  ["p-01", "Sculptural Stoneware Vase", "Home", "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=80", 68, 54, "Bestseller", "A hand-finished ceramic vase with a softly sculptural silhouette."],
  ["p-02", "Everyday Linen Throw", "Living", "https://images.unsplash.com/photo-1600369671236-e74521d4b6ad?auto=format&fit=crop&w=900&q=80", 92, null, "", "Relaxed European linen, woven for a softer everyday."],
  ["p-03", "Ripple Glass Carafe", "Home", "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80", 44, null, "Just in", "A tactile glass carafe for your table, bedside, or slow mornings."],
  ["p-04", "Arc Everyday Tote", "Accessories", "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80", 78, 62, "Save 20%", "A roomy, easy-to-carry tote made for wherever the day goes."],
  ["p-05", "Soft Form Candle", "Living", "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=900&q=80", 36, null, "", "A warm, woodsy blend poured slowly in a reusable vessel."],
  ["p-06", "Daily Carry Pouch", "Accessories", "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=900&q=80", 32, null, "", "Keep small essentials close with a considered canvas pouch."],
  ["p-07", "Sunday Serving Bowl", "Home", "https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=900&q=80", 58, 46, "Limited offer", "A generously sized stoneware bowl for shared tables."],
  ["p-08", "Woven Market Basket", "Accessories", "https://images.unsplash.com/photo-1591561954557-26941169b49e?auto=format&fit=crop&w=900&q=80", 64, null, "", "An everyday basket with room for market finds and more."],
];
if (db.prepare("SELECT COUNT(*) AS count FROM products").get().count === 0) {
  const insertProduct = db.prepare("INSERT INTO products (id,name,category,image,price,promo_price,badge,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  const seed = db.transaction(() => seedProducts.forEach(product => insertProduct.run(...product, new Date().toISOString())));
  seed();
}

const scrypt = promisify(crypto.scrypt);
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${Buffer.from(key).toString("hex")}`;
}
async function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, keyHex] = String(storedHash).split(":");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), 64));
  const expected = Buffer.from(keyHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (adminEmail && process.env.ADMIN_PASSWORD) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error("ADMIN_EMAIL must be a valid email address.");
  const existingAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!existingAdmin) {
    const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD);
    db.prepare("INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)")
      .run(crypto.randomUUID(), "Store owner", adminEmail, passwordHash, "admin", new Date().toISOString());
    console.info(`Owner account initialized for ${adminEmail}.`);
  } else {
    const account = db.prepare("SELECT role FROM users WHERE email = ?").get(adminEmail);
    if (account.role !== "admin") throw new Error("ADMIN_EMAIL belongs to a customer account. Choose a separate owner email.");
    const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD);
    db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(passwordHash, adminEmail);
  }
  db.prepare("UPDATE users SET role = 'customer' WHERE role = 'admin' AND email != ?").run(adminEmail);
}

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.getStatement = database.prepare("SELECT sess FROM sessions WHERE sid = ? AND expire > ?");
    this.setStatement = database.prepare("INSERT INTO sessions (sid,sess,expire) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire");
    this.touchStatement = database.prepare("UPDATE sessions SET expire = ? WHERE sid = ?");
    this.destroyStatement = database.prepare("DELETE FROM sessions WHERE sid = ?");
    this.database.prepare("DELETE FROM sessions WHERE expire <= ?").run(Date.now());
  }
  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 86400000;
      this.setStatement.run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (error) { callback(error); }
  }
  touch(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 86400000;
      this.touchStatement.run(expires, sid);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { this.destroyStatement.run(sid); callback(null); }
    catch (error) { callback(error); }
  }
}

const app = express();
const port = Number(process.env.PORT) || 3000;
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
    },
  },
}));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "forma.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use("/uploads", express.static(uploadsDir, { dotfiles: "deny", fallthrough: false, maxAge: "1d", immutable: true }));
const frontendOptions = { dotfiles: "deny", maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 };
app.get(["/", "/index.html"], (_req, res) => res.sendFile(path.join(__dirname, "index.html"), frontendOptions));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css"), frontendOptions));
app.get("/app.js", (_req, res) => res.sendFile(path.join(__dirname, "app.js"), frontendOptions));
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many sign-in attempts. Please wait and try again." } });
const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many orders were submitted. Please try again later." } });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false });

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, isAdmin: user.role === "admin" };
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.user?.role !== "admin") return res.status(403).json({ error: "Owner access is required." });
  next();
}
function requireCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const provided = req.get("x-csrf-token") || "";
  if (!expected || !provided || expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
  }
  next();
}
function safeSettings(row, includePrivate = false) {
  const settings = {
    currency: row.currency,
    shippingFee: row.shipping_fee,
    freeShippingThreshold: row.free_shipping_threshold,
    storeName: row.store_name,
  };
  if (includePrivate) Object.assign(settings, {
    bankName: row.bank_name,
    accountName: row.account_name,
    accountNumber: row.account_number,
    instructions: row.payment_instructions,
  });
  return settings;
}
function productFromRow(row) {
  return { id: row.id, name: row.name, category: row.category, image: row.image, price: row.price, promoPrice: row.promo_price, badge: row.badge, description: row.description };
}
function orderFromRow(row) {
  return {
    reference: row.reference, customerName: row.customer_name, customerEmail: row.customer_email,
    phone: row.phone, address: row.address, subtotal: row.subtotal, shipping: row.shipping,
    total: row.total, currency: row.currency, status: row.status, createdAt: row.created_at,
    items: db.prepare("SELECT product_id AS productId, name, quantity, unit_price AS unitPrice FROM order_items WHERE order_id = ?")
      .all(row.id),
  };
}
function normalizeProduct(body, imageOverride) {
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const image = imageOverride || String(body.image || "").trim();
  const price = Number(body.price);
  const promoPrice = body.promoPrice === "" || body.promoPrice == null ? null : Number(body.promoPrice);
  const badge = String(body.badge || "").trim();
  const description = String(body.description || "").trim();
  if (name.length < 1 || name.length > 160) throw Object.assign(new Error("Product name must be 1–160 characters."), { status: 400 });
  if (category.length < 1 || category.length > 80) throw Object.assign(new Error("Category must be 1–80 characters."), { status: 400 });
  if (!image || image.length > 2000 || (!image.startsWith("/uploads/") && !/^https:\/\/\S+$/i.test(image))) throw Object.assign(new Error("Choose a valid HTTPS image URL or upload an image."), { status: 400 });
  if (!Number.isFinite(price) || price <= 0 || price > 10000000) throw Object.assign(new Error("Enter a valid regular price."), { status: 400 });
  if (promoPrice !== null && (!Number.isFinite(promoPrice) || promoPrice <= 0 || promoPrice >= price)) throw Object.assign(new Error("Promo price must be a positive amount below the regular price."), { status: 400 });
  if (badge.length > 40 || description.length > 2000) throw Object.assign(new Error("Badge or description is too long."), { status: 400 });
  return { name, category, image, price, promoPrice, badge, description };
}
function validateText(value, label, max) {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw Object.assign(new Error(`${label} is required and must be no more than ${max} characters.`), { status: 400 });
  return text;
}
function csrfRotate(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
}

app.get("/api/bootstrap", (req, res) => {
  if (!req.session.csrfToken) csrfRotate(req);
  res.json({
    products: db.prepare("SELECT * FROM products ORDER BY created_at ASC").all().map(productFromRow),
    settings: safeSettings(db.prepare("SELECT * FROM settings WHERE id = 1").get()),
    user: req.session.user ? publicUser(req.session.user) : null,
    csrfToken: req.session.csrfToken,
  });
});
app.post("/api/auth/register", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const name = validateText(req.body.name, "Name", 120);
    const email = validateText(req.body.email, "Email", 254).toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 12 || password.length > 128) return res.status(400).json({ error: "Password must be between 12 and 128 characters." });
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "An account with that email already exists." });
    const user = { id: crypto.randomUUID(), name, email, passwordHash: await hashPassword(password) };
    db.prepare("INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)")
      .run(user.id, user.name, user.email, user.passwordHash, new Date().toISOString());
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = { id: user.id, name: user.name, email: user.email, role: "customer" };
    csrfRotate(req);
    res.status(201).json({ user: publicUser(req.session.user), csrfToken: req.session.csrfToken });
  } catch (error) { next(error); }
});
app.post("/api/auth/login", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ error: "Email or password was not recognized." });
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    csrfRotate(req);
    res.json({ user: publicUser(req.session.user), csrfToken: req.session.csrfToken });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", requireAuth, requireCsrf, (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("forma.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.status(204).end();
  });
});
app.get("/api/account/orders", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(req.session.user.id);
  res.json({ orders: rows.map(orderFromRow) });
});
app.get("/api/cart", requireAuth, (req, res) => {
  const items = db.prepare("SELECT product_id AS productId, quantity FROM cart_items WHERE user_id = ?").all(req.session.user.id);
  res.json({ items });
});
app.put("/api/cart", requireAuth, requireCsrf, (req, res, next) => {
  try {
    if (!Array.isArray(req.body.items) || req.body.items.length > 50) return res.status(400).json({ error: "A bag can contain up to 50 products." });
    const quantities = new Map();
    for (const item of req.body.items) {
      const productId = String(item.productId || "");
      const quantity = Number(item.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ error: "Bag quantities must be between 1 and 20." });
      quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    }
    if ([...quantities.values()].some(quantity => quantity > 20)) return res.status(400).json({ error: "Each product quantity must be 20 or less." });
    const update = db.transaction(() => {
      db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.session.user.id);
      const insert = db.prepare("INSERT INTO cart_items (user_id,product_id,quantity) VALUES (?,?,?)");
      for (const [productId, quantity] of quantities) insert.run(req.session.user.id, productId, quantity);
    });
    update();
    res.json({ items: db.prepare("SELECT product_id AS productId, quantity FROM cart_items WHERE user_id = ?").all(req.session.user.id) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return res.status(400).json({ error: "A product in your bag is no longer available." });
    next(error);
  }
});
app.get("/api/admin/orders", requireAuth, requireAdmin, adminLimiter, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  res.json({ orders: rows.map(orderFromRow) });
});
app.get("/api/admin/settings", requireAuth, requireAdmin, adminLimiter, (req, res) => {
  res.json({ settings: safeSettings(db.prepare("SELECT * FROM settings WHERE id = 1").get(), true) });
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      const error = new Error("Upload a JPG, PNG, or WebP image.");
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});
function verifyImage(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return ".jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}
app.post("/api/admin/uploads", requireAuth, requireAdmin, adminLimiter, requireCsrf, imageUpload.single("image"), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a product image to upload." });
    const extension = verifyImage(req.file.buffer);
    if (!extension) return res.status(400).json({ error: "The selected file is not a valid JPG, PNG, or WebP image." });
    const filename = `${crypto.randomUUID()}${extension}`;
    fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer, { flag: "wx" });
    res.status(201).json({ image: `/uploads/${filename}` });
  } catch (error) { next(error); }
});
app.post("/api/admin/products", requireAuth, requireAdmin, adminLimiter, requireCsrf, (req, res, next) => {
  try {
    const product = normalizeProduct(req.body);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO products (id,name,category,image,price,promo_price,badge,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, product.name, product.category, product.image, product.price, product.promoPrice, product.badge, product.description, new Date().toISOString());
    res.status(201).json({ product: productFromRow(db.prepare("SELECT * FROM products WHERE id = ?").get(id)) });
  } catch (error) { next(error); }
});
app.put("/api/admin/products/:id", requireAuth, requireAdmin, adminLimiter, requireCsrf, (req, res, next) => {
  try {
    if (!db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "Product not found." });
    const product = normalizeProduct(req.body);
    db.prepare("UPDATE products SET name=?,category=?,image=?,price=?,promo_price=?,badge=?,description=? WHERE id=?")
      .run(product.name, product.category, product.image, product.price, product.promoPrice, product.badge, product.description, req.params.id);
    res.json({ product: productFromRow(db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id)) });
  } catch (error) { next(error); }
});
app.delete("/api/admin/products/:id", requireAuth, requireAdmin, adminLimiter, requireCsrf, (req, res) => {
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Product not found." });
  res.status(204).end();
});
app.put("/api/admin/settings", requireAuth, requireAdmin, adminLimiter, requireCsrf, (req, res, next) => {
  try {
    const currency = String(req.body.currency || "").toUpperCase();
    const currencies = new Set(["USD", "GBP", "EUR", "CAD", "AUD", "NGN", "KES", "GHS", "INR"]);
    const shippingFee = Number(req.body.shippingFee);
    const freeShippingThreshold = Number(req.body.freeShippingThreshold);
    if (!currencies.has(currency)) return res.status(400).json({ error: "Choose a supported store currency." });
    if (!Number.isFinite(shippingFee) || shippingFee < 0 || !Number.isFinite(freeShippingThreshold) || freeShippingThreshold < 0) return res.status(400).json({ error: "Shipping amounts must be zero or greater." });
    const storeName = validateText(req.body.storeName, "Store name", 100);
    const values = [
      currency, String(req.body.bankName || "").trim().slice(0, 120),
      String(req.body.accountName || "").trim().slice(0, 120),
      String(req.body.accountNumber || "").trim().slice(0, 80),
      String(req.body.instructions || "").trim().slice(0, 1000),
      shippingFee, freeShippingThreshold, storeName,
    ];
    db.prepare("UPDATE settings SET currency=?,bank_name=?,account_name=?,account_number=?,payment_instructions=?,shipping_fee=?,free_shipping_threshold=?,store_name=? WHERE id=1").run(...values);
    res.json({ settings: safeSettings(db.prepare("SELECT * FROM settings WHERE id=1").get(), true) });
  } catch (error) { next(error); }
});
const orderStatuses = new Set(["Awaiting payment", "Payment received", "Processing", "Shipped", "Completed", "Cancelled"]);
app.patch("/api/admin/orders/:reference", requireAuth, requireAdmin, adminLimiter, requireCsrf, (req, res) => {
  const status = String(req.body.status || "");
  if (!orderStatuses.has(status)) return res.status(400).json({ error: "Choose a valid order status." });
  const result = db.prepare("UPDATE orders SET status = ? WHERE reference = ?").run(status, req.params.reference);
  if (!result.changes) return res.status(404).json({ error: "Order not found." });
  const row = db.prepare("SELECT * FROM orders WHERE reference = ?").get(req.params.reference);
  res.json({ order: orderFromRow(row) });
});
app.post("/api/orders", checkoutLimiter, requireAuth, requireCsrf, (req, res, next) => {
  try {
    const name = validateText(req.body.name, "Name", 120);
    const address = validateText(req.body.address, "Delivery address", 500);
    const phone = validateText(req.body.phone, "Phone number", 40);
    const requestedItems = req.body.items;
    if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 50) return res.status(400).json({ error: "Your bag must have between 1 and 50 products." });
    const quantities = new Map();
    for (const item of requestedItems) {
      const id = String(item.productId || "");
      const quantity = Number(item.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ error: "Each item quantity must be between 1 and 20." });
      quantities.set(id, (quantities.get(id) || 0) + quantity);
    }
    if ([...quantities.values()].some(quantity => quantity > 20)) return res.status(400).json({ error: "Each item quantity must be 20 or less." });
    const products = [...quantities].map(([id, quantity]) => {
      const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
      if (!row) throw Object.assign(new Error("A product in your bag is no longer available. Refresh your bag and try again."), { status: 400 });
      return { row, quantity, unitPrice: row.promo_price && row.promo_price < row.price ? row.promo_price : row.price };
    });
    const subtotal = Math.round(products.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
    const settings = db.prepare("SELECT * FROM settings WHERE id=1").get();
    const shipping = subtotal >= settings.free_shipping_threshold ? 0 : settings.shipping_fee;
    const total = Math.round((subtotal + shipping) * 100) / 100;
    const orderId = crypto.randomUUID();
    const reference = `FM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const createOrder = db.transaction(() => {
      db.prepare("INSERT INTO orders (id,reference,user_id,customer_name,customer_email,phone,address,subtotal,shipping,total,currency,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(orderId, reference, req.session.user.id, name, req.session.user.email, phone, address, subtotal, shipping, total, settings.currency, "Awaiting payment", createdAt);
      const addItem = db.prepare("INSERT INTO order_items (order_id,product_id,name,quantity,unit_price) VALUES (?,?,?,?,?)");
      for (const item of products) addItem.run(orderId, item.row.id, item.row.name, item.quantity, item.unitPrice);
      db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.session.user.id);
    });
    createOrder();
    const order = orderFromRow(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
    const bankDetails = settings.bank_name && settings.account_name && settings.account_number ? {
      bankName: settings.bank_name, accountName: settings.account_name,
      accountNumber: settings.account_number, instructions: settings.payment_instructions,
    } : null;
    res.status(201).json({ order, bankDetails });
  } catch (error) { next(error); }
});

app.post("/api/newsletter", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false }), requireCsrf, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
  db.prepare("INSERT OR IGNORE INTO subscribers (email,created_at) VALUES (?,?)").run(email, new Date().toISOString());
  res.status(201).json({ message: "Thanks for subscribing." });
});
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((_req, res) => res.status(404).send("Not found."));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "Images must be 8 MB or smaller." : "The image upload could not be processed.";
    return res.status(400).json({ error: message });
  }
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error("Request failed:", error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const server = app.listen(port, () => console.info(`Forma storefront listening at http://localhost:${port}`));
const sessionCleanup = setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expire <= ?").run(Date.now());
}, 60 * 60 * 1000);
function shutdown() {
  clearInterval(sessionCleanup);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
