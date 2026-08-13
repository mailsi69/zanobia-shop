# Zanobia Sewing — Build Record

This document is the "prompt + code for record" for the Zanobia Sewing eCommerce app:
a reusable build prompt, a requirement-by-requirement map to the code, the data model,
and the key algorithms. Keep it with the project so the build can be reproduced or extended.

---

## 1. Reproduction prompt

> Build a complete, mobile-first eCommerce app for a clothing brand called **Zanobia Sewing**,
> in the spirit of the Shopbop app (buy designer clothing, shoes, accessories; new users get
> 15% off their first full-price order with code `APP15`). Requirements:
>
> - **Storefront**: product catalogue with title + description, images, sizes/colours,
>   categories, search, product detail, cart, and a continuously-featured "Highlights" rail.
> - **Checkout**: customer enters shipping information; the app then **calculates USA shipping
>   and sales tax automatically** and takes payment. On payment, **email the store owner/store
>   email and the customer**.
> - **Roles**: an **Admin** who can upload products, delete them, and keep them in **draft**;
>   a **Super Admin** who can change *everything* — store name, phone, address, and any edit,
>   add, or remove, including staff.
> - **Growth**: SEO-enabled (meta, sitemap, structured data), social-media connectable,
>   installable like an app (PWA). Ship within the USA only.
>
> Deliver runnable code (Node + Express + SQLite backend, PWA frontend), demo data, an admin
> console, and documentation. Payments and email must work in a demo mode with no external
> accounts, and be swappable for Stripe + SMTP in production.
>
> **Visual design**: follow the supplied "AURA" brand board *same-to-same*, substituting the
> word **Zanobia** for AURA — teal `#1D7F7A` / aqua `#7EC4C1` / seafoam `#BFDCD8` / cream
> `#FAF6F1` / pink `#F4A6B8` / rose `#E07A8A` / gold `#C9A86A`, Playfair Display + Poppins,
> and a Rajasthani **block-print** motif as the signature. Include the lotus emblem, the
> "— Sewing —" lockup, the "Chic. Timeless. You." tagline, the Shop Now / View Collection
> buttons, and the four value-prop circles (Free Shipping, Easy Returns, Hand-Finished,
> Secure Payments).
>
> **Also add**: extra categories (Men, Bedroom Linen, Bags, Blouses, Pants); cross-cutting
> **collection filters** (New Arrivals, Summer Collection, Sale); a proper **inline search bar**
> (not a pop-up); a **wishlist**; **customer-data capture with explicit marketing consent**, a
> super-admin **Customers** list with **CSV export**, and an editable **privacy policy** page;
> and a self-running **45-second demo** (`public/demo.html`) for stakeholder sign-off.

*Design note: the visual system is adapted from a client-supplied "AURA Rajasthan" brand
board, rebranded to Zanobia Sewing at the client's request.*

---

## 2. Requirements → implementation

| # | Requirement (as given) | How it's met | Where |
|---|---|---|---|
| 1 | Create code with complete research | Full-stack app, researched Shopbop feature set (catalogue, first-order promo, PWA) + USA shipping/tax model | whole repo |
| 2 | At the end, a complete prompt + code for record | This file (`PROMPT_AND_RECORD.md`) + `README.md` | here |
| 3a | Admin can **upload** inventory | Create-product form + `POST /api/admin/products`; image upload via URL or file | `admin.js`, `index.js` |
| 3b | Admin can **delete** | `DELETE /api/admin/products/:id` with confirm | `admin.js`, `index.js` |
| 3c | Admin can **keep in draft** | Status `draft/active/archived`; one-tap Publish/Draft; drafts never show in storefront | `index.js` (`status`), `admin.js` |
| 3d | **Super Admin** can change **everything** (name, phone, address, any edit, add/remove) | Store settings editor + staff management, gated to `super_admin` | `admin.js` (Settings/Staff), `index.js` (`/api/super/*`) |
| 4a | **Add to cart, checkout, payment** | Cart drawer + checkout + Stripe/mock gateway | `store.js`, `payment.js` |
| 4b | **After payment, email owner/store email** (and customer) | `finalizeOrder()` sends owner + customer emails | `index.js`, `email.js` |
| 4c | **Continuously highlight inventory** | Featured flag → "Highlights" rail; low-stock / sale / sold-out badges | `store.js`, admin "Feature" toggle |
| 4d | **Connect to social media** | Instagram/Facebook/TikTok/Pinterest links, editable by Super Admin, shown in footer | `admin.js` Settings, `store.js` footer |
| 4e | **SEO enabled** | Dynamic meta + Open Graph, `sitemap.xml`, `robots.txt`, Product/Store JSON-LD | `index.html`, `store.js`, `index.js` |
| 4f | **Product title + description** | Required fields on every product; shown on cards + detail | schema + PDP |
| 4g | **Shipping calculator incl. tax percentage** | `/api/quote` returns shipping, tax, and the tax **rate %** used | `shipping.js`, `tax.js` |
| 4h | Customer adds shipping info, then app **calculates shipping (USA only) and tax by itself** | Checkout recalculates live on address entry; non-US is rejected | `store.js` `refreshQuote()`, `shipping.js` |
| 4i | "Best / most utility app for a clothing brand" | PWA install, offline shell, mobile-first UI, admin + super-admin, full commerce flow | whole repo |

---

## 3. Architecture

```
Customer (PWA)                Staff (Admin console)
   store.js  ─┐                 admin.js  ─┐
              │  fetch /api        (JWT)    │  fetch /api  (Bearer JWT)
              ▼                             ▼
        ┌──────────────────── Express (server/index.js) ────────────────────┐
        │  /api/store  /api/products  /api/quote  /api/checkout             │
        │  /api/auth/*  /api/admin/*  /api/super/*   /sitemap.xml /robots   │
        └───────┬───────────┬───────────┬───────────┬───────────┬──────────┘
             shipping.js   tax.js    payment.js   email.js     db.js (SQLite)
             (USA rates)  (state %)  (Stripe/mock)(SMTP/outbox) products/orders/
                                                                users/settings
```

Design decisions:
- **One pricing engine** (`buildQuote()`), used by both the live quote and checkout, so the
  price the customer sees is exactly the price charged. Prices are always taken **server-side**
  from the DB — the client never sends prices.
- **Roles** enforced by middleware: `admin` for inventory/orders, `super_admin` for settings/staff.
  `super_admin` implicitly passes `admin` checks.
- **Demo-first**: mock payment + file outbox mean the full flow runs with no accounts; swap in
  Stripe + SMTP via `.env` with no code changes.

## 4. Data model (SQLite)

- **products**: title, slug, description, price_cents, compare_at_cents, category, sizes[], colors[],
  images[], stock, weight_oz, status(draft/active/archived), featured, seo_title, seo_description, tags[]
- **orders**: number, email, customer_name, phone, ship_address{}, items[snapshot], subtotal_cents,
  discount_cents, discount_code, shipping_cents, tax_cents, total_cents, status, payment_status, payment_ref
- **users**: email, password_hash (bcrypt), name, role(admin/super_admin)
- **settings**: key/value store — name, tagline, store_email, phone, address, currency, shipping
  params, tax_overrides, social{}, seo, promo_code, promo_percent

## 5. Key algorithms (for the record)

**First-order discount (APP15)** — 15% off *full-price* items only, once per email:
```
promo valid  ⇢  code == settings.promo_code
first order  ⇢  no prior order exists for this email
eligible     ⇢  sum of items where compare_at is null  (full-price)
discount     ⇢  round(fullPriceSubtotal * promo_percent/100)
```

**USA shipping** (`server/lib/shipping.js`):
```
reject if country != US or state not in 50 states + DC
weightLb = max(1, ceil(totalOunces / 16))
if subtotal >= free_ship_threshold ⇢ 0
else base + per_lb*(weightLb-1)  (+ AK/HI surcharge)
```

**USA sales tax** (`server/lib/tax.js`):
```
rate = tax_overrides[state] ?? STATE_BASE_RATE[state] ?? 0
apparel-exempt states (MN, NJ, PA, VT) ⇢ rate 0
base = (subtotal - discount) (+ shipping if ship_tax_shipping)
tax  = round(base * rate)      // rate % is returned to the UI
```
> Production note: swap `calcTax()` for Stripe Tax / TaxJar / Avalara for full local compliance.

**Checkout → email** (`server/index.js`):
```
buildQuote() → create order (pending/unpaid) → payment intent
mock: captured now → finalizeOrder()
stripe: client confirms → /checkout/confirm → finalizeOrder()
finalizeOrder(): decrement stock, mark paid, email owner + customer
```

## 6. Extension roadmap
- Stripe Elements card form + webhook for authoritative payment status
- Customer accounts, order history, saved addresses, wishlists
- Real tax API; international shipping zones
- Inventory variants (size/colour level stock), collections, discounts/coupons engine
- Image CDN + optimization; analytics + abandoned-cart email
- Server-side rendering / prerender for maximal SEO

---

## 8. Design system & later additions (AURA reskin)

**Palette** — teal `#1D7F7A`, aqua `#7EC4C1`, seafoam `#BFDCD8`, cream `#FAF6F1` (page),
pink `#F4A6B8`, rose `#E07A8A`, charcoal `#333333`, gold `#C9A86A`. White cards on cream.
**Type** — Playfair Display (display) + Poppins (body/UI), via Google Fonts.
**Signature** — Rajasthani block-print "buti" sprig (`public/img/blockprint.svg`) as wallpaper
behind the hero and footer; gold lotus emblem (`public/img/emblem.svg`). Tokens live in
`public/css/styles.css` `:root`.

**Feature additions**

| Feature | How it works | Where |
|---|---|---|
| New categories | Men, Bedroom Linen, Bags, Blouses, Pants seeded; categories are dynamic | `db.js` demo array, `/api/categories` |
| Collection filters | `?collection=new\|summer\|sale` (sale = compare-at > price; new/summer = tags) | `index.js` `/api/products`, `store.js` chips |
| Inline search | Expanding header search field → `/api/products?q=` results grid (replaces old pop-up) | `index.html`, `store.js` |
| Wishlist | Heart on cards / PDP; saved to `localStorage(zs_wish)`; `/wishlist` view | `store.js` |
| Customer capture (consent) | Checkout consent checkbox → order `marketing_consent`; on paid order, opted-in customers upserted | `store.js`, `index.js` `upsertCustomer`, `customers` table |
| Customers admin + CSV | Super-admin **Customers** tab; `GET /api/super/customers` + `/customers.csv` | `admin.js`, `index.js` |
| Privacy policy | Editable `privacy_policy` setting; `/privacy` page; linked from checkout + footer | `db.js` settings, `store.js` `viewPrivacy` |
| 45-second demo | Self-running 12-scene walkthrough with progress bar, play/pause, replay | `public/demo.html` |

**Settings added** (super-admin editable): `collect_customer_data`, `marketing_consent_label`,
`privacy_policy`. **Schema added**: `customers` table; `orders.marketing_consent` column
(added by a safe boot migration in `db.js`).

**Consent rule**: a customer row is only created/updated when `collect_customer_data` is on
**and** the shopper ticked consent **and** the order is paid — verified in testing (opted-in
shopper saved; non-consenting shopper not saved).
