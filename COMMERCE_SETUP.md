# HI FASHION — Accounts, sellers and commerce setup

## Implemented in this repository

### Storefront
- Floating shopping cart fixed to the right edge in every language, including Arabic right-to-left mode.
- Cart quantities, saved items and gift-card preview items.
- Customer account drawer with email/password sign-up, sign-in, password reset, sign-out and customer profile editing.
- Customer order history.
- Seller application form and application-status history.
- Approved seller workspace for creating draft product listings, publishing/unpublishing products and viewing seller orders.
- Live catalogue reads only published, in-stock EUR products from Supabase.
- Product cards add real product IDs to the cart.
- Stripe-hosted Checkout handoff and seller payout onboarding.

### Backend
- Supabase migrations for seller profiles, products, customers, seller applications, orders, order items, inventory reservation, gift cards, gift-card transactions, wishlists and webhook event records.
- Stripe Checkout Edge Function verifies the customer session, product IDs, prices, seller state, inventory, shipping rate and order total on the server.
- Stripe Connect Express onboarding for approved sellers.
- Administrator-only seller-review Edge Function with an allowlist of Supabase Auth user IDs.
- Signed Stripe webhook updates paid orders and issues gift cards after confirmed payment.

## Important: not live for payments yet

The code is committed, but **the marketplace is not a live store yet**. Provider accounts, secrets, database deployment, shipping, tax and operational/legal setup have not been configured in this repository. No real payments are being accepted.

Live checkout stays disabled unless both `COMMERCE_LIVE_ENABLED=true` and `STRIPE_AUTOMATIC_TAX_ENABLED=true` are set in private Edge Function secrets. Do not turn these on before the full test plan below is complete.

## 1. Connect Supabase

1. Create a Supabase project and enable Email authentication.
2. Configure the production site URL, redirect URL and email confirmation.
3. Apply the migrations in order:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
4. Edit `site-config.js` and set the public project URL and publishable/anon key:
   ```js
   window.HI_FASHION_SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT_REF.supabase.co",
     anonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
   };
   ```
5. Deploy `site-config.js` beside `index.html`.

The publishable/anon key is intended for browser use with Row Level Security enabled. **Never put the Supabase service-role/secret key, Stripe secret, webhook secret, email API key or gift-card encryption key in `site-config.js` or browser code.**

## 2. Configure Stripe and private Edge Function secrets

Create the Stripe account for the actual legal business. Activate Connect and review the platform and connected-account country eligibility, seller verification, payout, dispute responsibilities and fees. Stripe's supported-country information is at https://stripe.com/global.

Use Stripe test mode first. Configure Stripe Tax for the relevant jurisdictions and create an active fixed EUR shipping rate. The first physical checkout supports EUR and one seller per order.

Set these private Edge Function secrets in Supabase (never commit values to GitHub):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` (test key initially)
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL` (exact HTTPS origin of the deployed website)
- `PLATFORM_COMMISSION_BPS` (100 basis points = 1%; agree the commission first)
- `STRIPE_SHIPPING_RATE_ID` (active EUR shipping rate)
- `STRIPE_AUTOMATIC_TAX_ENABLED` = `true` only after Stripe Tax is configured
- `COMMERCE_LIVE_ENABLED` = keep disabled until test and launch checks pass
- `STRIPE_ALLOWED_SHIPPING_COUNTRIES` = reviewed ISO alpha-2 destination codes, comma-separated
- `ADMIN_USER_IDS` = comma-separated Supabase Auth UUIDs of authorised seller reviewers
- `GIFT_CARD_ENCRYPTION_KEY` = base64-encoded random 32-byte key
- `RESEND_API_KEY`
- `GIFT_CARD_FROM_EMAIL` = verified sender address on your email domain

## 3. Deploy Supabase Edge Functions

From the repository root:
```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-connect-onboarding-link
supabase functions deploy review-seller-application
supabase functions deploy stripe-webhook --no-verify-jwt
```

The first three functions require a valid Supabase user JWT. The Stripe webhook has gateway JWT verification disabled because Stripe does not send a Supabase JWT; the function verifies Stripe's webhook signature.

Configure this Stripe webhook URL:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Subscribe to:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `account.updated`

## 4. Seller onboarding and approval

1. A customer registers and confirms their email.
2. The customer submits a seller application in My Account.
3. An administrator UUID listed in `ADMIN_USER_IDS` reviews the application using `review-seller-application`.
4. Approval creates an approved seller profile.
5. The seller completes Stripe Connect Express onboarding and bank/payout verification.
6. The seller adds draft products and publishes them after stock, authenticity and fulfilment checks.
7. Published, in-stock products appear in the live catalogue.

The admin approval function is server-side and allowlisted. It is not exposed as an approval button for ordinary users.

## 5. Orders, shipping and gift cards

- Product prices, seller IDs and stock are loaded server-side; client-supplied prices are not trusted.
- Physical orders support one seller at a time. Mixed-seller carts are rejected in this initial release.
- Inventory is reserved before Checkout and released when the Checkout Session expires or payment fails.
- Gift cards must be purchased separately from physical products.
- Gift-card codes are generated on the server after a paid Stripe webhook; the database stores a hash and an encrypted delivery copy, then sends the code using Resend.
- **Gift-card redemption against a future product order is not enabled yet.** The cart's apply-code field remains a preview.
- Shipping label generation and carrier tracking integrations are future work.

## 6. Test before accepting real money

- Registration, email confirmation, login, password reset, sign-out and profile updates.
- Confirm customers cannot read another customer's profile or order history.
- Confirm non-admin users cannot approve seller applications.
- Seller application, approval, Connect onboarding, incomplete verification and disabled payout states.
- Draft listings, publish/unpublish, seller-only access and public catalogue visibility.
- Stripe Checkout success, cancellation, failure, expiry and webhook retries.
- Inventory contention, reservation and release.
- Gift-card one-time issuance, encrypted code storage, email delivery and duplicate webhook delivery.
- Tax calculation, permitted destination countries, shipping, refunds, disputes, consumer rights, returns, privacy policy, terms and customer support in each launch market.

## Current limits
- Supabase and Stripe project credentials have not been configured in this repository.
- Migrations and Edge Functions must be deployed before customer accounts, orders and seller workspaces can connect to live data.
- The live catalogue stays empty until approved sellers add and publish genuine listings.
- Checkout remains disabled until Stripe, tax, shipping, legal and operational setup is complete.
- Gift-card redemption, multi-seller settlement and shipping-label generation are not included in this first release.
