# Zanobia Sewing — eCommerce App

A complete, mobile-first eCommerce application for the **Zanobia Sewing** clothing brand,
modeled on the Shopbop app experience. Installable as a PWA (works like a native app),
with a storefront, checkout, USA shipping + tax engine, order email, an **Admin** console
for inventory, and a **Super Admin** console with full control over the store.

---

## Quick start

```bash
# 1. Install (Node 18+)
npm install

# 2. Configure (optional — runs fully in demo mode without this)
cp .env.example .env      # then edit .env

# 3. Run
npm start
```

Open:
- **Storefront** → http://localhost:3000
- **Admin console** → http://localhost:3000/admin

**Demo logins** (created on first run, change in `.env`):
| Role | Email | Password |
|---|---|---|
| Super Admin | `super@zanobiasewing.com` | `changeme-super` |
| Admin | `admin@zanobiasewing.com` | `changeme-admin` |

The database (`data/zanobia.db`), 16 demo products, and admin accounts are created automatically
on first launch. To re-seed: delete the `data/` folder and restart.

---

## What it does

**Storefront (customer)**
- Product grid with **category** tabs (Dresses, Blouses, Pants, Bags, Shoes, Accessories, Men, Bedroom Linen…) and **collection filters** (New Arrivals, Summer Collection, Sale)
- **Inline search bar** in the header (searches title, description, tags and category)
- Product detail with size/colour and image gallery; **wishlist** (tap ❤ to save, `/wishlist` view)
- "Highlights" rail of continuously featured products; sale + new + low-stock + sold-out badges
- Cart drawer with live subtotal and free-shipping progress — the cart is saved on the device, so shoppers can **keep browsing and searching without losing it**
- Checkout: enter shipping info → **shipping & sales tax are calculated automatically for the USA**
- `APP15` promo: **15% off the first full-price order** per customer
- **Marketing opt-in** at checkout (with a linked **Privacy Policy** page) — consenting customers are saved for future deals
- Order confirmation, plus **email to the store owner and the customer** on payment
- SEO: dynamic meta tags, Open Graph, `sitemap.xml`, `robots.txt`, Product/Store JSON-LD
- Social links in footer; PWA install (manifest + service worker + icons)

**Admin** (`admin` role)
- Upload products, edit content, set **draft / active / archived** ("keep in draft")
- Delete products, feature/unfeature, upload images (URL or file), manage stock
- View orders, order details, update order status

**Super Admin** (`super_admin` role) — *everything the admin can do, plus:*
- Edit **store name, tagline, owner email, phone, address**
- Configure shipping (free threshold, base rate, per-lb, AK/HI surcharge, tax-on-shipping)
- Override state **tax rates**, set the promo code/percent, edit SEO copy and **social links**
- Toggle **customer-data collection**, edit the **consent label** and **privacy policy**
- View the **Customers** list (opted-in only) and **export to CSV** for future deals
- Manage staff accounts (add/remove admins and super admins)

---

## Design

The interface follows the **"AURA" brand board** (rebranded to Zanobia at the client's request):
teal `#1D7F7A` / aqua `#7EC4C1` / seafoam `#BFDCD8` / cream `#FAF6F1` / pink `#F4A6B8` /
rose `#E07A8A` / gold `#C9A86A`, **Playfair Display + Poppins**, and a Rajasthani **block-print**
motif as the signature (see `public/img/blockprint.svg`, `public/img/emblem.svg`). All design
tokens live in `public/css/styles.css`.

## Stakeholder demo

`public/demo.html` is a **self-running 45-second walkthrough** (open it directly in a browser,
or visit `/demo.html` while the server runs) that showcases every feature — for quick sign-off.

---

## Going live (production)

The app runs end-to-end in **demo mode** with zero external accounts (mock payments, emails
saved to `server/outbox/`). To take real orders, set these in `.env`:

**Card payments — Stripe.** Add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`
(test keys from the Stripe dashboard). The server switches from the mock gateway to real
Stripe PaymentIntents automatically. For full card entry, add Stripe.js on the checkout page
and confirm the `client_secret` before calling `/api/checkout/confirm` (see `js/store.js`,
`placeOrder()` — the hook is already there).

**Order email — SMTP.** Add `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
Without these, emails are written to `server/outbox/*.eml` so you can verify the flow.

**Sales tax.** Built-in per-state base rates are a sane default and are **not** full local
compliance (US tax also has county/city district rates and category rules). For production,
replace the body of `server/lib/tax.js → calcTax()` with a call to **Stripe Tax**, **TaxJar**,
or **Avalara** — it already receives the taxable amount, shipping, and destination state.

**Search-engine SEO for an SPA.** Meta tags + JSON-LD + sitemap are in place. For maximum
crawlability, front the app with server-side rendering or prerendering (e.g. Next.js or a
prerender service); the JSON API is already separated to make that straightforward.

**Deploy.** Any Node host (Render, Railway, Fly.io, a VPS). Set `NODE_ENV=production`,
a strong `JWT_SECRET`, and `SITE_URL` to your domain. SQLite is fine for a single instance;
for multiple instances switch `server/db.js` to Postgres/MySQL (schema is standard SQL).

---

## Project structure

```
zanobia-shop/
├── server/
│   ├── index.js          Express app: store, checkout, admin, super-admin, SEO
│   ├── db.js             SQLite schema + seed (products, admins, settings)
│   └── lib/
│       ├── shipping.js   USA shipping calculator
│       ├── tax.js        USA sales-tax calculator (per-state, override-able)
│       ├── payment.js    Stripe or mock gateway
│       ├── email.js      SMTP or file-outbox order emails
│       └── auth.js       JWT + role middleware (admin / super_admin)
├── public/
│   ├── index.html        Storefront shell
│   ├── admin.html        Admin console shell
│   ├── css/styles.css    Design system
│   ├── js/store.js       Storefront SPA
│   ├── js/admin.js       Admin/super-admin SPA
│   ├── manifest.webmanifest, sw.js, img/   PWA
├── .env.example
├── README.md
└── PROMPT_AND_RECORD.md  Full build record + reproduction prompt
```

## API reference (summary)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/store` | — | Public store config |
| GET | `/api/products` `?q&category` | — | Active products |
| GET | `/api/products/:slug` | — | One product |
| POST | `/api/quote` | — | Live subtotal + discount + shipping + tax |
| POST | `/api/checkout` | — | Create order + payment intent |
| POST | `/api/checkout/confirm` | — | Finalize (Stripe) → email |
| POST | `/api/auth/login` | — | Staff login |
| GET/POST/PUT/DELETE | `/api/admin/products…` | admin | Inventory CRUD, status, upload |
| GET/PATCH | `/api/admin/orders…` | admin | Orders |
| GET/PUT | `/api/super/settings` | super | Store settings |
| GET/POST/DELETE | `/api/super/users…` | super | Staff |
| GET | `/sitemap.xml`, `/robots.txt` | — | SEO |
