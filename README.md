# Forma commerce

Responsive storefront and Node.js backend for products, customer accounts, owner administration, carts, orders, uploads, and manual bank-transfer checkout.

## Run locally

Requirements: Node.js 22.13 or newer and npm.

1. Install the packages with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET` to a new random value of at least 32 characters, and configure `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters.
4. Start the app using `npm start`, then open `http://localhost:3000`.

The first start creates the owner account from the environment values and seeds the example product catalog. Product, account, order, and session data are kept in a SQLite database in `../forma-data/` by default; uploaded product photos are stored alongside it. Set `DATA_DIR` and `UPLOADS_DIR` to persistent storage paths when deploying.

Open **Owner portal** in the footer and sign in with the owner credentials to manage products, orders, payment details, currency, and shipping. Product photos may be uploaded as JPG, PNG, or WebP (up to 8 MB), or specified as an HTTPS image URL.

## Backend behavior and deployment

- Customer and owner passwords are hashed using Node's scrypt. Login sessions are stored in SQLite and use HTTP-only, same-site cookies; state-changing requests are protected with CSRF tokens.
- Order totals and current product prices are calculated on the server, not accepted from the browser. Customer order history and owner order management use the database.
- Bank account details are excluded from public storefront data and are returned to the customer only when their order is created.
- Checkout currently records an order for manual bank transfer; it does not automatically verify transfers, charge a card, send emails, or calculate tax.
- The included SQLite database and local file uploads need durable storage and backups. For production, deploy behind HTTPS, set `NODE_ENV=production`, configure `TRUST_PROXY=true` only behind a trusted reverse proxy, and supply a long random `SESSION_SECRET`. Use persistent volumes for the database and uploads.
- Configure the store owner account before deployment. Keep `.env` and all production credentials out of source control; `.gitignore` excludes `.env`, uploads, and local data.

The starter catalog and store settings can be changed from the owner portal. Shipping defaults to 5.95 in the chosen currency, with free shipping from 75; both values are editable.
