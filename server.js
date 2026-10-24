import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionSecret = process.env.SESSION_SECRET || "";
const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const imageBucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
const migrateAdminCredentials = process.env.MIGRATE_ADMIN_CREDENTIALS === "true";
const missingConfig = [];
if (sessionSecret.length < 32 || sessionSecret.startsWith("replace-with-")) missingConfig.push("SESSION_SECRET (new random value, at least 32 characters)");
if (!databaseUrl) missingConfig.push("SUPABASE_DB_URL (Supabase transaction-pooler connection string)");
if (!supabaseUrl) missingConfig.push("SUPABASE_URL");
if (!supabaseServiceRoleKey) missingConfig.push("SUPABASE_SERVICE_ROLE_KEY (server-only secret)");
if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) missingConfig.push("ADMIN_EMAIL (valid owner email)");
if (adminPassword.length < 12 || adminPassword.startsWith("replace-with-")) missingConfig.push("ADMIN_PASSWORD (unique password, at least 12 characters)");
if (missingConfig.length) throw new Error(`Missing or invalid configuration: ${missingConfig.join(", ")}.`);

const deliveryLocations = [
  ["Abia", 5.532, 7.486], ["Adamawa", 9.2035, 12.4954], ["Akwa Ibom", 5.0377, 7.9128],
  ["Anambra", 6.2104, 7.0723], ["Bauchi", 10.3158, 9.8442], ["Bayelsa", 4.9267, 6.2676],
  ["Benue", 7.7322, 8.5391], ["Borno", 11.8333, 13.15], ["Cross River", 4.9757, 8.3417],
  ["Delta", 6.198, 6.7319], ["Ebonyi", 6.3249, 8.1137], ["Edo", 6.335, 5.6037],
  ["Ekiti", 7.6233, 5.22], ["Enugu", 6.4584, 7.5464], ["Gombe", 10.2897, 11.1673],
  ["Imo", 5.484, 7.035], ["Jigawa", 11.7562, 9.338], ["Kaduna", 10.5105, 7.4165],
  ["Kano", 12.0022, 8.5919], ["Katsina", 12.9908, 7.6177], ["Kebbi", 12.4539, 4.1975],
  ["Kogi", 7.8023, 6.7333], ["Kwara", 8.4966, 4.5421], ["Lagos", 6.6018, 3.3515],
  ["Nasarawa", 8.4912, 8.5167], ["Niger", 9.6139, 6.5569], ["Ogun", 7.1475, 3.3619],
  ["Ondo", 7.2571, 5.2058], ["Osun", 7.7827, 4.5418], ["Oyo", 7.3775, 3.947],
  ["Plateau", 9.8965, 8.8583], ["Rivers", 4.8156, 7.0498], ["Sokoto", 13.0059, 5.2476],
  ["Taraba", 8.8937, 11.3596], ["Yobe", 11.748, 11.966], ["Zamfara", 12.1628, 6.6614],
  ["Federal Capital Territory", 9.0765, 7.3986],
].map(([name, latitude, longitude]) => ({ name, latitude, longitude }));
const deliveryLocationByName = new Map(deliveryLocations.map(location => [location.name.toLowerCase(), location]));

const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, "supabase", "prod-ca-2021.crt"), "utf8"),
    rejectUnauthorized: true,
  },
});
pool.on("error", error => console.error("Unexpected idle database connection error:", error));

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const PgSessionStore = connectPgSimple(session);
const sessionStore = new PgSessionStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 15,
});

const starterProducts = [
  ["p-01", "Pearl Glow Beaded Clutch", "Evening Bags", "https://images.pexels.com/photos/28387111/pexels-photo-28387111/free-photo-of-a-gold-purse-on-a-wooden-table.jpeg?auto=compress&cs=tinysrgb&w=900", 48000, 42000, "Bestseller", "A hand-finished statement clutch, made for celebrations, dinners and every reason to dress up."],
  ["p-02", "Colour Pop Beaded Shoulder Bag", "Beaded Bags", "https://images.pexels.com/photos/33574332/pexels-photo-33574332/free-photo-of-colorful-beaded-handbags-and-jewelry-display.jpeg?auto=compress&cs=tinysrgb&w=900", 58000, null, "Just in", "A joyful pop of colour, finished with careful beadwork and a comfortable shoulder strap."],
  ["p-03", "Dewdrop Crystal Mini Bag", "Evening Bags", "https://images.pexels.com/photos/28387111/pexels-photo-28387111/free-photo-of-a-gold-purse-on-a-wooden-table.jpeg?auto=compress&cs=tinysrgb&w=900", 68000, null, "New", "A compact conversation starter with light-catching details and room for your evening essentials."],
  ["p-04", "Everyday Beaded Crossbody", "Beaded Bags", "https://images.pexels.com/photos/9777614/pexels-photo-9777614.jpeg?auto=compress&cs=tinysrgb&w=900", 72000, 65000, "Customer favourite", "Hands-free, full of personality and ready to go wherever your day takes you."],
  ["p-05", "Golden Hour Bead Handle Bag", "Beaded Bags", "https://images.pexels.com/photos/33574332/pexels-photo-33574332/free-photo-of-colorful-beaded-handbags-and-jewelry-display.jpeg?auto=compress&cs=tinysrgb&w=900", 85000, null, "Statement piece", "A standout beaded handle bag that brings a little extra occasion to your outfit."],
  ["p-06", "Petal Party Beaded Purse", "Evening Bags", "https://images.pexels.com/photos/28387111/pexels-photo-28387111/free-photo-of-a-gold-purse-on-a-wooden-table.jpeg?auto=compress&cs=tinysrgb&w=900", 39000, null, "", "Playful colour and floral-inspired beadwork come together in this charming little purse."],
  ["p-07", "Beaded Phone & Coin Pouch", "Accessories", "https://images.pexels.com/photos/9777614/pexels-photo-9777614.jpeg?auto=compress&cs=tinysrgb&w=900", 28000, null, "", "A handy little pouch for the small essentials, finished with a touch of sparkle."],
  ["p-08", "Starlight Beaded Earrings", "Jewellery", "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=80", 18000, null, "Made to shine", "Lightweight beaded earrings with a little shimmer for everyday outfits and special plans."],
];
const legacyStarterNames = [
  "Sculptural Stoneware Vase", "Everyday Linen Throw", "Ripple Glass Carafe", "Arc Everyday Tote",
  "Soft Form Candle", "Daily Carry Pouch", "Sunday Serving Bowl", "Woven Market Basket",
];
const legacyStarterImages = [
  "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1591561954557-26941169b49e?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=80",
];

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

async function initialize() {
  await pool.query(
    `ALTER TABLE public.settings
     ADD COLUMN IF NOT EXISTS domestic_delivery_base_fee numeric(12,2) NOT NULL DEFAULT 2500,
     ADD COLUMN IF NOT EXISTS domestic_delivery_per_km_fee numeric(12,2) NOT NULL DEFAULT 15,
     ADD COLUMN IF NOT EXISTS international_delivery_fee numeric(12,2) NOT NULL DEFAULT 20000`,
  );
  await pool.query(
    "ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS custom_description text NOT NULL DEFAULT ''",
  );
  await pool.query(
    "INSERT INTO public.settings (id,currency,shipping_fee,free_shipping_threshold) VALUES (1,'NGN',3500,100000) ON CONFLICT (id) DO NOTHING",
  );
  await pool.query(
    "UPDATE public.settings SET currency='NGN',shipping_fee=3500,free_shipping_threshold=100000 WHERE id=1 AND currency='USD' AND shipping_fee=5.95 AND free_shipping_threshold=75",
  );
  await pool.query(
    "UPDATE public.settings SET store_name='BeadsbyBambie' WHERE id=1 AND store_name='Forma'",
  );
  for (const [index, product] of starterProducts.entries()) {
    await pool.query(
      `UPDATE public.products SET name=$2,category=$3,image=$4,price=$5,promo_price=$6,badge=$7,description=$8
       WHERE id=$1 AND name=$9`,
      [...product.slice(0, 8), legacyStarterNames[index]],
    );
    await pool.query(
      "UPDATE public.products SET image=$3 WHERE id=$1 AND name=$2 AND image=$4",
      [product[0], product[1], product[3], legacyStarterImages[index]],
    );
    await pool.query(
      `INSERT INTO public.products (id,name,category,image,price,promo_price,badge,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      product,
    );
  }
  const credentialClient = await pool.connect();
  try {
    await credentialClient.query("BEGIN");
    const { rows: targetRows } = await credentialClient.query(
      "SELECT id, role FROM public.users WHERE email = $1 FOR UPDATE",
      [adminEmail],
    );
    if (targetRows.length && targetRows[0].role !== "admin" && !migrateAdminCredentials) {
      throw new Error("ADMIN_EMAIL already belongs to a customer account. Configure a separate owner email.");
    }
    const { rows: admins } = await credentialClient.query(
      "SELECT id FROM public.users WHERE role = 'admin' FOR UPDATE",
    );
    if (admins.length > 1) {
      throw new Error("Multiple owner accounts exist. Resolve them before migrating owner credentials.");
    }
    if (migrateAdminCredentials && targetRows.length && targetRows[0].role === "customer") {
      const newPasswordHash = await hashPassword(adminPassword);
      await credentialClient.query(
        "UPDATE public.users SET role = 'admin', password_hash = $1 WHERE id = $2",
        [newPasswordHash, targetRows[0].id],
      );
      if (admins.length === 1) {
        await credentialClient.query(
          "UPDATE public.users SET role = 'customer' WHERE id = $1",
          [admins[0].id],
        );
      }
      console.info("Owner login credentials migrated to the existing account.");
    } else if (migrateAdminCredentials && admins.length === 1) {
      await credentialClient.query(
        "UPDATE public.users SET email = $1, password_hash = $2 WHERE id = $3",
        [adminEmail, await hashPassword(adminPassword), admins[0].id],
      );
      console.info("Owner login credentials migrated.");
    } else if (migrateAdminCredentials && admins.length === 0) {
      await credentialClient.query(
        "INSERT INTO public.users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'admin')",
        [crypto.randomUUID(), "Store owner", adminEmail, await hashPassword(adminPassword)],
      );
      console.info("Owner account initialized.");
    } else if (!targetRows.length && admins.length) {
      throw new Error("ADMIN_EMAIL differs from the existing owner account. Set MIGRATE_ADMIN_CREDENTIALS=true for a one-time credential change.");
    } else if (!targetRows.length) {
      await credentialClient.query(
        "INSERT INTO public.users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'admin')",
        [crypto.randomUUID(), "Store owner", adminEmail, await hashPassword(adminPassword)],
      );
      console.info("Owner account initialized.");
    }
    await credentialClient.query("COMMIT");
  } catch (error) {
    await credentialClient.query("ROLLBACK");
    throw error;
  } finally {
    credentialClient.release();
  }
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(imageBucket);
  if (bucketError && !/not found|does not exist/i.test(bucketError.message)) throw bucketError;
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(imageBucket, { public: true, fileSizeLimit: "8MB", allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] });
    if (error && !/already exists/i.test(error.message)) throw error;
  } else if (!bucket.public) {
    const { error } = await supabase.storage.updateBucket(imageBucket, { public: true, fileSizeLimit: "8MB", allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] });
    if (error) throw error;
  }
}
const ready = initialize();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://images.pexels.com", "https://*.supabase.co"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
    },
  },
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  ready.then(() => next()).catch(next);
});
app.use(session({
  name: "forma.sid",
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.get("/owner.html", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
const heroImages = new Set([
  "cowrie-jewellery.jpg",
  "beaded-bags.jpg",
  "colourful-bags.jpg",
  "beaded-keychains.jpg",
]);
app.get("/images/hero/:image", (req, res, next) => {
  if (!heroImages.has(req.params.image)) return next();
  res.sendFile(path.join(__dirname, "public", "images", "hero", req.params.image));
});
if (!process.env.VERCEL) {
  app.use(express.static(__dirname, { dotfiles: "deny", index: "index.html" }));
}

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
async function requireAdmin(req, res, next) {
  try {
    if (!req.session.user) return res.status(401).json({ error: "Please sign in to continue." });
    const { rows } = await pool.query(
      "SELECT name, email, role FROM public.users WHERE id = $1",
      [req.session.user.id],
    );
    if (!rows.length) return res.status(403).json({ error: "Owner access is required." });
    Object.assign(req.session.user, rows[0]);
    if (req.session.user.role !== "admin") return res.status(403).json({ error: "Owner access is required." });
    next();
  } catch (error) {
    next(error);
  }
}
function requireCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const provided = req.get("x-csrf-token") || "";
  if (!expected || !provided || expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
  }
  next();
}
function csrfRotate(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
}
function safeSettings(row, includePrivate = false) {
  const settings = {
    currency: row.currency, shippingFee: Number(row.shipping_fee),
    freeShippingThreshold: Number(row.free_shipping_threshold), storeName: row.store_name,
    domesticDeliveryBaseFee: Number(row.domestic_delivery_base_fee),
    domesticDeliveryPerKmFee: Number(row.domestic_delivery_per_km_fee),
    internationalDeliveryFee: Number(row.international_delivery_fee),
    deliveryLocations: deliveryLocations.map(({ name }) => name),
  };
  if (includePrivate) Object.assign(settings, {
    bankName: row.bank_name, accountName: row.account_name,
    accountNumber: row.account_number, instructions: row.payment_instructions,
  });
  return settings;
}
function calculateDeliveryQuote(countryCode, stateName, subtotal, settings) {
  if (countryCode === "INTL") {
    return { fee: Number(settings.international_delivery_fee), estimatedRoadKm: null, isFree: false };
  }
  if (countryCode !== "NG") throw Object.assign(new Error("Choose a valid delivery destination."), { status: 400 });
  const location = deliveryLocationByName.get(String(stateName || "").toLowerCase());
  if (!location) throw Object.assign(new Error("Choose a valid Nigerian state or territory."), { status: 400 });
  const origin = deliveryLocationByName.get("ogun");
  const toRadians = degrees => degrees * Math.PI / 180;
  const latitudeDifference = toRadians(location.latitude - origin.latitude);
  const longitudeDifference = toRadians(location.longitude - origin.longitude);
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(location.latitude))
    * Math.sin(longitudeDifference / 2) ** 2;
  const straightLineKm = 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  const estimatedRoadKm = Math.ceil(straightLineKm * 1.35);
  const calculatedFee = Math.ceil(
    (Number(settings.domestic_delivery_base_fee) + estimatedRoadKm * Number(settings.domestic_delivery_per_km_fee)) / 500,
  ) * 500;
  const isFree = subtotal >= Number(settings.free_shipping_threshold);
  return { fee: isFree ? 0 : calculatedFee, estimatedRoadKm, isFree };
}
function productFromRow(row) {
  return {
    id: row.id, name: row.name, category: row.category, image: row.image,
    price: Number(row.price), promoPrice: row.promo_price === null ? null : Number(row.promo_price),
    badge: row.badge, description: row.description,
  };
}
async function orderFromRow(row, client = pool) {
  const { rows } = await client.query(
    "SELECT product_id AS \"productId\", name, quantity, unit_price AS \"unitPrice\", custom_description AS \"customDescription\" FROM public.order_items WHERE order_id = $1 ORDER BY id",
    [row.id],
  );
  return {
    reference: row.reference, customerName: row.customer_name, customerEmail: row.customer_email,
    phone: row.phone, address: row.address, subtotal: Number(row.subtotal),
    shipping: Number(row.shipping), total: Number(row.total), currency: row.currency,
    status: row.status, createdAt: row.created_at, items: rows.map(item => ({ ...item, unitPrice: Number(item.unitPrice) })),
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
  if (!image || image.length > 2000 || (!image.startsWith("https://") && !image.startsWith("http"))) throw Object.assign(new Error("Choose a valid HTTPS image URL or upload an image."), { status: 400 });
  if (!/^https:\/\/\S+$/i.test(image)) throw Object.assign(new Error("Product image URLs must use HTTPS."), { status: 400 });
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
function dbError(error) {
  if (error.code === "23505") return Object.assign(new Error("An account with that email already exists."), { status: 409 });
  if (error.code === "23503") return Object.assign(new Error("A product in your bag is no longer available."), { status: 400 });
  return error;
}

app.get("/api/bootstrap", async (req, res, next) => {
  try {
    if (!req.session.csrfToken) csrfRotate(req);
    const [{ rows: products }, { rows: settings }] = await Promise.all([
      pool.query("SELECT * FROM public.products ORDER BY created_at ASC"),
      pool.query("SELECT * FROM public.settings WHERE id = 1"),
    ]);
    res.json({
      products: products.map(productFromRow), settings: safeSettings(settings[0]),
      user: req.session.user ? publicUser(req.session.user) : null, csrfToken: req.session.csrfToken,
    });
  } catch (error) { next(error); }
});
app.get("/api/delivery/quote", async (req, res, next) => {
  try {
    const countryCode = String(req.query.countryCode || "");
    const stateName = String(req.query.state || "");
    const subtotal = Number(req.query.subtotal);
    if (!Number.isFinite(subtotal) || subtotal < 0 || subtotal > 100000000) {
      return res.status(400).json({ error: "A valid order subtotal is required for delivery pricing." });
    }
    const { rows } = await pool.query("SELECT * FROM public.settings WHERE id = 1");
    res.json(calculateDeliveryQuote(countryCode, stateName, subtotal, rows[0]));
  } catch (error) { next(error); }
});
app.post("/api/auth/register", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const name = validateText(req.body.name, "Name", 120);
    const email = validateText(req.body.email, "Email", 254).toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 12 || password.length > 128) return res.status(400).json({ error: "Password must be between 12 and 128 characters." });
    const user = { id: crypto.randomUUID(), name, email, passwordHash: await hashPassword(password) };
    await pool.query("INSERT INTO public.users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'customer')", [user.id, user.name, user.email, user.passwordHash]);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = { id: user.id, name: user.name, email: user.email, role: "customer" };
    csrfRotate(req);
    res.status(201).json({ user: publicUser(req.session.user), csrfToken: req.session.csrfToken });
  } catch (error) { next(dbError(error)); }
});
app.post("/api/auth/login", authLimiter, requireCsrf, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const { rows } = await pool.query("SELECT * FROM public.users WHERE email = $1", [email]);
    const user = rows[0];
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
app.get("/api/account/orders", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM public.orders WHERE user_id = $1 ORDER BY created_at DESC", [req.session.user.id]);
    res.json({ orders: await Promise.all(rows.map(row => orderFromRow(row))) });
  } catch (error) { next(error); }
});
app.get("/api/cart", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT product_id AS "productId", quantity FROM public.cart_items WHERE user_id = $1', [req.session.user.id]);
    res.json({ items: rows });
  } catch (error) { next(error); }
});
app.put("/api/cart", requireAuth, requireCsrf, async (req, res, next) => {
  let client;
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
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("DELETE FROM public.cart_items WHERE user_id = $1", [req.session.user.id]);
    for (const [productId, quantity] of quantities) {
      await client.query("INSERT INTO public.cart_items (user_id,product_id,quantity) VALUES ($1,$2,$3)", [req.session.user.id, productId, quantity]);
    }
    await client.query("COMMIT");
    const { rows } = await pool.query('SELECT product_id AS "productId", quantity FROM public.cart_items WHERE user_id = $1', [req.session.user.id]);
    res.json({ items: rows });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(dbError(error));
  } finally { client?.release(); }
});
app.get("/api/admin/orders", requireAuth, requireAdmin, adminLimiter, async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM public.orders ORDER BY created_at DESC");
    res.json({ orders: await Promise.all(rows.map(row => orderFromRow(row))) });
  } catch (error) { next(error); }
});
app.get("/api/admin/settings", requireAuth, requireAdmin, adminLimiter, async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM public.settings WHERE id = 1");
    res.json({ settings: safeSettings(rows[0], true) });
  } catch (error) { next(error); }
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
app.post("/api/admin/uploads", requireAuth, requireAdmin, adminLimiter, requireCsrf, imageUpload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a product image to upload." });
    const extension = verifyImage(req.file.buffer);
    if (!extension) return res.status(400).json({ error: "The selected file is not a valid JPG, PNG, or WebP image." });
    const filename = `${crypto.randomUUID()}${extension}`;
    const { error } = await supabase.storage.from(imageBucket).upload(filename, req.file.buffer, {
      contentType: req.file.mimetype, cacheControl: "31536000", upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(imageBucket).getPublicUrl(filename);
    res.status(201).json({ image: data.publicUrl });
  } catch (error) { next(error); }
});
app.post("/api/admin/products", requireAuth, requireAdmin, adminLimiter, requireCsrf, async (req, res, next) => {
  try {
    const product = normalizeProduct(req.body);
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO public.products (id,name,category,image,price,promo_price,badge,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, product.name, product.category, product.image, product.price, product.promoPrice, product.badge, product.description],
    );
    res.status(201).json({ product: productFromRow(rows[0]) });
  } catch (error) { next(error); }
});
app.put("/api/admin/products/:id", requireAuth, requireAdmin, adminLimiter, requireCsrf, async (req, res, next) => {
  try {
    const product = normalizeProduct(req.body);
    const { rows } = await pool.query(
      `UPDATE public.products SET name=$1,category=$2,image=$3,price=$4,promo_price=$5,badge=$6,description=$7
       WHERE id=$8 RETURNING *`,
      [product.name, product.category, product.image, product.price, product.promoPrice, product.badge, product.description, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found." });
    res.json({ product: productFromRow(rows[0]) });
  } catch (error) { next(error); }
});
app.delete("/api/admin/products/:id", requireAuth, requireAdmin, adminLimiter, requireCsrf, async (req, res, next) => {
  try {
    const { rows } = await pool.query("DELETE FROM public.products WHERE id = $1 RETURNING id", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Product not found." });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.put("/api/admin/settings", requireAuth, requireAdmin, adminLimiter, requireCsrf, async (req, res, next) => {
  try {
    const currency = String(req.body.currency || "").toUpperCase();
    const currencies = new Set(["USD", "GBP", "EUR", "CAD", "AUD", "NGN", "KES", "GHS", "INR"]);
    const domesticDeliveryBaseFee = Number(req.body.domesticDeliveryBaseFee);
    const domesticDeliveryPerKmFee = Number(req.body.domesticDeliveryPerKmFee);
    const internationalDeliveryFee = Number(req.body.internationalDeliveryFee);
    const freeShippingThreshold = Number(req.body.freeShippingThreshold);
    if (!currencies.has(currency)) return res.status(400).json({ error: "Choose a supported store currency." });
    const deliveryFees = [domesticDeliveryBaseFee, domesticDeliveryPerKmFee, internationalDeliveryFee, freeShippingThreshold];
    if (deliveryFees.some(amount => !Number.isFinite(amount) || amount < 0 || amount > 10000000)) return res.status(400).json({ error: "Delivery amounts must be between zero and 10,000,000." });
    const storeName = validateText(req.body.storeName, "Store name", 100);
    const { rows } = await pool.query(
      `UPDATE public.settings SET currency=$1,bank_name=$2,account_name=$3,account_number=$4,
       payment_instructions=$5,domestic_delivery_base_fee=$6,domestic_delivery_per_km_fee=$7,
       international_delivery_fee=$8,free_shipping_threshold=$9,store_name=$10
       WHERE id=1 RETURNING *`,
      [
        currency, String(req.body.bankName || "").trim().slice(0, 120),
        String(req.body.accountName || "").trim().slice(0, 120),
        String(req.body.accountNumber || "").trim().slice(0, 80),
        String(req.body.instructions || "").trim().slice(0, 1000),
        domesticDeliveryBaseFee, domesticDeliveryPerKmFee, internationalDeliveryFee,
        freeShippingThreshold, storeName,
      ],
    );
    res.json({ settings: safeSettings(rows[0], true) });
  } catch (error) { next(error); }
});
const orderStatuses = new Set(["Awaiting payment", "Payment received", "Processing", "Shipped", "Completed", "Cancelled"]);
app.patch("/api/admin/orders/:reference", requireAuth, requireAdmin, adminLimiter, requireCsrf, async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!orderStatuses.has(status)) return res.status(400).json({ error: "Choose a valid order status." });
    const { rows } = await pool.query("UPDATE public.orders SET status=$1 WHERE reference=$2 RETURNING *", [status, req.params.reference]);
    if (!rows.length) return res.status(404).json({ error: "Order not found." });
    res.json({ order: await orderFromRow(rows[0]) });
  } catch (error) { next(error); }
});
app.post("/api/orders", checkoutLimiter, requireAuth, requireCsrf, async (req, res, next) => {
  let client;
  try {
    const name = validateText(req.body.name, "Name", 120);
    const streetAddress = validateText(req.body.address, "Delivery address", 500);
    const phone = validateText(req.body.phone, "Phone number", 40);
    const countryCode = String(req.body.countryCode || "");
    let countryName;
    let stateName = "";
    if (countryCode === "NG") {
      stateName = validateText(req.body.state, "State", 80);
      if (!deliveryLocationByName.has(stateName.toLowerCase())) {
        return res.status(400).json({ error: "Choose a valid Nigerian state or territory." });
      }
      countryName = "Nigeria";
    } else if (countryCode === "INTL") {
      countryName = validateText(req.body.country, "Country", 100);
      if (countryName.toLowerCase() === "nigeria") {
        return res.status(400).json({ error: "Choose Nigeria to receive a Nigerian delivery quote." });
      }
    } else {
      return res.status(400).json({ error: "Choose Nigeria or outside Nigeria as your delivery destination." });
    }
    const address = [streetAddress, stateName, countryName].filter(Boolean).join(", ");
    const requestedItems = req.body.items;
    if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 50) return res.status(400).json({ error: "Your bag must have between 1 and 50 products." });
    const quantities = new Map();
    const customDescriptions = new Map();
    for (const item of requestedItems) {
      const id = String(item.productId || "");
      const quantity = Number(item.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ error: "Each item quantity must be between 1 and 20." });
      const customDescription = String(item.customDescription || "").trim();
      if (customDescription.length > 500) return res.status(400).json({ error: "Product requests must be 500 characters or less." });
      quantities.set(id, (quantities.get(id) || 0) + quantity);
      customDescriptions.set(id, customDescription);
    }
    if ([...quantities.values()].some(quantity => quantity > 20)) return res.status(400).json({ error: "Each item quantity must be 20 or less." });
    client = await pool.connect();
    await client.query("BEGIN");
    const products = [];
    for (const [id, quantity] of quantities) {
      const { rows } = await client.query("SELECT * FROM public.products WHERE id=$1 FOR SHARE", [id]);
      if (!rows.length) throw Object.assign(new Error("A product in your bag is no longer available. Refresh your bag and try again."), { status: 400 });
      const row = rows[0];
      products.push({ row, quantity, customDescription: customDescriptions.get(id) || "", unitPrice: Number(row.promo_price) > 0 && Number(row.promo_price) < Number(row.price) ? Number(row.promo_price) : Number(row.price) });
    }
    const subtotal = Math.round(products.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
    const { rows: settingsRows } = await client.query("SELECT * FROM public.settings WHERE id=1");
    const settings = settingsRows[0];
    const { fee: shipping } = calculateDeliveryQuote(countryCode, stateName, subtotal, settings);
    const total = Math.round((subtotal + shipping) * 100) / 100;
    const orderId = crypto.randomUUID();
    const reference = `FM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const { rows: orderRows } = await client.query(
      `INSERT INTO public.orders (id,reference,user_id,customer_name,customer_email,phone,address,subtotal,shipping,total,currency,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Awaiting payment') RETURNING *`,
      [orderId, reference, req.session.user.id, name, req.session.user.email, phone, address, subtotal, shipping, total, settings.currency],
    );
    for (const item of products) {
      await client.query(
        "INSERT INTO public.order_items (order_id,product_id,name,quantity,unit_price,custom_description) VALUES ($1,$2,$3,$4,$5,$6)",
        [orderId, item.row.id, item.row.name, item.quantity, item.unitPrice, item.customDescription],
      );
    }
    await client.query("DELETE FROM public.cart_items WHERE user_id=$1", [req.session.user.id]);
    await client.query("COMMIT");
    const order = await orderFromRow(orderRows[0]);
    const bankDetails = settings.bank_name && settings.account_name && settings.account_number ? {
      bankName: settings.bank_name, accountName: settings.account_name,
      accountNumber: settings.account_number, instructions: settings.payment_instructions,
    } : null;
    res.status(201).json({ order, bankDetails });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(dbError(error));
  } finally { client?.release(); }
});
app.post("/api/newsletter", rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false }), requireCsrf, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    await pool.query("INSERT INTO public.subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", [email]);
    res.status(201).json({ message: "Thanks for subscribing." });
  } catch (error) { next(error); }
});
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "Images must be 8 MB or smaller." : "The image upload could not be processed.";
    return res.status(400).json({ error: message });
  }
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error("Request failed:", error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

if (process.env.VERCEL) {
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
  app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css")));
  app.get("/app.js", (_req, res) => res.sendFile(path.join(__dirname, "app.js")));
} else {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => console.info(`BeadsbyBambie storefront listening at http://localhost:${port}`));
  function shutdown() {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export default app;
