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
- `PLATFORM_COMMISSION_BPS` = `1000` (1000 basis points = 10%; approved HI FASHION platform commission, calculated on product subtotal before shipping and tax). The checkout function defaults to 10% if this private secret is not set.
- `STRIPE_SHIPPING_RATE_ID` (active EUR shipping rate)
- `STRIPE_AUTOMATIC_TAX_ENABLED` = `true` only after Stripe Tax is configured
- `COMMERCE_LIVE_ENABLED` = keep disabled until test and launch checks pass
- `STRIPE_ALLOWED_SHIPPING_COUNTRIES` = reviewed ISO alpha-2 destination codes, comma-separated
- `ADMIN_USER_IDS` = comma-separated Supabase Auth UUIDs of authorised seller reviewers
- `GIFT_CARD_ENCRYPTION_KEY` = base64-encoded random 32-byte key
- `RESEND_API_KEY`
- `GIFT_CARD_FROM_EMAIL` = verified sender address on your email domain


### HI FASHION commission and Revolut bank payouts

The approved HI FASHION platform commission is **10%** of the product subtotal for physical product orders processed through HI FASHION's own Stripe Checkout. Shipping and tax are excluded. Gift-card-only checkouts do not incur this product commission.

Set the matching private Supabase Edge Function secret:

```bash
supabase secrets set PLATFORM_COMMISSION_BPS=1000
```

The checkout function has a 10% default, but explicitly setting this secret makes the production configuration clear.

For product orders, Stripe Connect destination charges send the application fee to the HI FASHION platform Stripe balance and route the remaining product proceeds to the seller's connected Stripe account. The application fee is gross platform commission before Stripe processing fees, refunds, disputes or other applicable costs. The platform's Stripe processing fees may reduce net commission.

To receive HI FASHION platform payouts in Revolut:
1. Use a Revolut Business account belonging to the same legal business/entity shown on the HI FASHION platform Stripe account. Revolut's Bulgarian Business help centre states that Revolut Business can receive payouts from Stripe. Personal-account eligibility must be confirmed with Stripe before relying on it.
2. In Revolut Business, open the EUR account and choose **Details**. Copy the EUR IBAN, BIC and account-holder details shown there. EEA business accounts may have an LT IBAN; use the exact details displayed by Revolut for the EUR account.
3. In the HI FASHION platform's Stripe Dashboard, open **Settings → Business → Bank accounts and currencies** (wording may vary), select EUR settlement and add the Revolut EUR account. Complete any ownership or verification prompts from Stripe.
4. Set the Stripe payout schedule after the account is verified. The commission first accrues in the platform Stripe balance; it is paid to Revolut on the selected payout schedule, not immediately at each customer sale.
5. Keep seller bank details separate: each marketplace seller completes their own Stripe Connect onboarding and adds their own payout bank account.

Never put Revolut account numbers, IBANs, login credentials, card details, Stripe secret keys or verification codes in this repository, in website JavaScript or in ChatGPT. Add bank details only through the official Revolut and Stripe apps/sites.

**External retailer links:** HI FASHION does not automatically earn 10% when a buyer follows a link and buys on an outside retailer's website. Those sales require an approved affiliate/partner agreement and tracking with that retailer.

Live checkout must remain disabled until the Stripe platform account, EUR Revolut payout account, seller Connect onboarding, tax, shipping, test transactions and required legal/operational checks are completed.

## 3A. Global retailer catalogue and authorised partner feeds

The catalogue migrations create the database structures only. They do **not** automatically grant access to retailer inventory or insert products. Real product listings require publisher/advertiser approval, licensed feed or API access, and the relevant private credentials.

### Apply the final feed-cursor migration

After migrations 001–009, run `supabase/migrations/202611240010_catalogue_feed_cursor_metadata.sql` in Supabase SQL Editor. It adds the saved CSV/TSV header, delimiter and total-byte fields needed by the resumable feed importer.

### Deploy the catalogue Edge Functions

A manual workflow is available at **GitHub → Actions → Deploy HI FASHION catalogue functions → Run workflow**. It deploys:
- `import-retailer-feed` — administrator-only Awin/CJ CSV or TSV importer.
- `search-cj-catalogue` — live CJ product search.
- `search-ebay-catalogue` — live eBay Browse search.

Before starting the workflow, add a GitHub repository Actions secret named `SUPABASE_ACCESS_TOKEN`. Create this token in Supabase account **Access Tokens**. The workflow targets project `nbluqcydijvjwcjzvank`. Never put this token in website JavaScript, source code, commits or public issues.

### Configure private Supabase Edge Function secrets

In Supabase → **Project Settings → Edge Functions → Secrets** (dashboard wording may vary), add credentials only for providers for which HI FASHION has been approved. Never put these values in `site-config.js`, `index.html`, GitHub commits or public documentation.

For the protected feed importer:
- `SUPABASE_URL` — the project's HTTPS URL.
- `SUPABASE_SERVICE_ROLE_KEY` — the private service-role key.
- `ADMIN_USER_IDS` — comma-separated Supabase Auth user UUIDs authorised to run imports.

For authorised Awin product feeds:
- `AWIN_FEED_URL` or a feed-specific `AWIN_FEED_<FEED_SUFFIX>_URL`.
- Optional `AWIN_FEED_BEARER_TOKEN`, `AWIN_DEFAULT_COUNTRY`, `AWIN_DEFAULT_CURRENCY`.

For authorised CJ CSV/TSV feeds:
- `CJ_FEED_URL` or a feed-specific `CJ_FEED_<FEED_SUFFIX>_URL`.
- Optional `CJ_FEED_BEARER_TOKEN`, `CJ_DEFAULT_COUNTRY`, `CJ_DEFAULT_CURRENCY`.

For live CJ product search:
- `CJ_PERSONAL_ACCESS_TOKEN`
- `CJ_COMPANY_ID`
- `CJ_PUBLISHER_ID`

For live eBay Browse API search:
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- Optional `EBAY_AFFILIATE_CAMPAIGN_ID` and `EBAY_AFFILIATE_REFERENCE_ID` for eligible affiliate tracking.

### Start an authorised feed import

The importer accepts POST requests with an administrator's Supabase Auth access token. Example body:

```json
{
  "source_code": "awin",
  "feed_id": "fashion-eu"
}
```

Use `source_code` `awin` or `cj`; `feed_id` identifies a feed inside that network. A large feed may return `complete: false` while batches are processed. Call it again with the same source and feed ID until it returns `complete: true`.

The storefront already queries the local catalogue and can request live CJ/eBay results once provider secrets are configured. Awin listings appear after an approved Awin feed is imported. Import and display only product data permitted under each partner agreement. API access or a feed download does not by itself grant permission to advertise every retailer or brand.

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
