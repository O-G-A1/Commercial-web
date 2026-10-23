# Forma beaded goods

Responsive Nigeria-focused storefront for hand-beaded bags, clutches, jewellery, and accessories, with customer accounts, owner product management, photo uploads, carts, orders, and manual bank-transfer checkout. Production data is stored in Supabase Postgres; product photos are stored in Supabase Storage. The app is configured for Vercel Functions.

## Supabase setup

1. Create a Supabase project and save its database password securely.
2. In **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql). The app connects with a server-only database connection; Row Level Security is enabled on application tables.
3. From **Project Settings → API**, copy the Project URL and the `service_role` key. Keep the key private. It is only used by the server for Storage administration and must never be used in frontend code.
4. From **Connect**, select the **Transaction pooler** and copy the Postgres connection URI. Replace its password placeholder with the database password. Do not commit this URI.
5. Add environment variables to `.env` for local development or to **Vercel → Project → Settings → Environment Variables** for deployment:

   - `SESSION_SECRET`: generate with `openssl rand -base64 48`.
   - `SUPABASE_URL`: the project URL.
   - `SUPABASE_DB_URL`: the transaction-pooler connection URI.
   - `SUPABASE_SERVICE_ROLE_KEY`: service-role secret.
   - `SUPABASE_STORAGE_BUCKET`: `product-images` (default).
   - `ADMIN_EMAIL`: owner login.
   - `ADMIN_PASSWORD`: a unique password of at least 12 characters.

The first server initialization creates the public `product-images` bucket if needed, adds NGN store settings (₦3,500 shipping and free shipping from ₦100,000), seeds beaded-product examples when missing, and creates the owner account if its email is not already present. On startup, the app replaces only unchanged built-in sample products with the beaded examples. It changes the legacy USD/default shipping settings only when those settings still match their untouched starter values; custom products, owner-edited products, bank details, and orders are preserved. Example catalog prices and stock photos are placeholders—replace them with your actual prices and product photos in the owner dashboard.

## Run locally

Use Node.js 22.13 or newer and npm. After completing Supabase setup and setting the environment variables, run:

```sh
npm install
npm start
```

Then open `http://localhost:3000`. `.env.example` shows the required variable names; copy it to `.env` and replace all placeholders. Never commit `.env`.

## Deploy to Vercel

1. Push this project to GitHub and import the repository in Vercel.
2. Add all environment variables above in the Vercel project settings for **Production** (and Preview if needed).
3. Deploy. The Express application in `server.js` runs as the API function; `index.html`, `app.js`, and `styles.css` are included in its bundle.
4. Visit the deployment URL and smoke-test sign-in, owner product creation, image upload, checkout, and orders.
5. Add a custom domain later if desired; Vercel provides a deployment URL without buying one.

Use a separate Supabase project for Vercel Preview deployments if you want to keep test data isolated from production.

## Data and security

- Customer and owner passwords are scrypt-hashed; sessions are persisted in Postgres and use HTTP-only, same-site cookies. State-changing requests require a CSRF token.
- Product and image administration is owner-only. Public storefront responses never include bank account details.
- Order totals are recalculated by the server from current database prices. Orders and line items are committed in one transaction.
- Store payment remains manual bank transfer: the app does not verify transfers, charge cards, send email, or calculate taxes.
- Back up the Supabase database and configure its production security/backup settings. Product photos are stored separately in Supabase Storage.
- If any credentials were committed to GitHub, revoke/rotate them. Removing a secret from a later commit does not remove it from Git history.
