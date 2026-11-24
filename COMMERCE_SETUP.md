# HI FASHION commerce backend

This repository now contains a **commerce preview** in \`index.html\` and the first server-side implementation foundation under \`supabase/\`.

## What is present

- Browser cart, quantity controls and saved-items preview.
- Gift-card purchase form (preview only).
- PostgreSQL tables for sellers, product catalog, orders, order items, gift cards, gift-card transactions, wishlists and Stripe webhook idempotency.
- Atomic inventory reservation/release database functions.
- Stripe Checkout session Edge Function.
- Stripe Connect Express seller-onboarding Edge Function.
- Stripe webhook Edge Function that marks paid orders and issues gift cards only after Stripe confirms payment.
- Checkout is deliberately disabled in the browser until the Edge Function URL is configured.

## Important first-launch limits

This is not yet a live store. The browser-only products have demo IDs and cannot be charged. A real seller must be approved, have a published product in the database, complete Stripe Connect onboarding, and have a verified bank/payout configuration. The first marketplace checkout version limits a cart to **one seller at a time** so funds are routed to the correct connected account. Carts with products from multiple sellers need a separate-charges-and-transfers settlement implementation before being enabled.

Gift cards can be purchased separately. The initial implementation intentionally does not allow mixing gift-card purchases with physical goods in one checkout. Gift-card redemption against an order is a separate ledger/reservation feature and is not enabled by this first foundation.

## Provider and account setup

1. Create a Supabase project. Enable email authentication and set the production site URL and redirect URLs.
2. Apply the database schema:
   \`\`\`bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   \`\`\`
3. Create a Stripe account for the actual legal business. Stripe lists Bulgaria as a supported account country: https://stripe.com/global
4. Activate Stripe Connect and review your platform's connected-account country eligibility, required seller verification, payout schedule, dispute responsibilities and fees with Stripe before inviting sellers.
5. Create a Stripe webhook endpoint for the deployed \`stripe-webhook\` function. Subscribe to:
   - \`checkout.session.completed\`
   - \`checkout.session.async_payment_succeeded\`
   - \`checkout.session.expired\`
   - \`checkout.session.async_payment_failed\`
6. Configure all Edge Function secrets. Never commit secret values into Git or browser JavaScript.

## Supabase Edge Function secrets

- \`SUPABASE_URL\`
- \`SUPABASE_SERVICE_ROLE_KEY\`
- \`STRIPE_SECRET_KEY\` (use a test key first)
- \`STRIPE_WEBHOOK_SECRET\`
- \`APP_BASE_URL\` (the production site origin)
- \`PLATFORM_COMMISSION_BPS\` (set only after the seller commission policy is agreed; 100 = 1%)
- \`STRIPE_SHIPPING_RATE_ID\` (required for physical-goods checkout; configure a real shipping rate before checkout is enabled)
- \`GIFT_CARD_ENCRYPTION_KEY\` (base64-encoded 32-byte AES-256 key)
- \`RESEND_API_KEY\` (for gift-card delivery email)
- \`GIFT_CARD_FROM_EMAIL\` (a verified sender address on your email domain)

For a seller, the \`seller_profiles\` row must be created by an authenticated seller application workflow and approved by an administrator. The onboarding endpoint only allows an approved seller profile.

## Deploy

\`\`\`bash
supabase functions deploy create-checkout-session
supabase functions deploy create-connect-onboarding-link
supabase functions deploy stripe-webhook --no-verify-jwt
\`\`\`

The Stripe webhook must use signature verification in the function, so it is deployed with Supabase JWT verification disabled; Stripe's own signature is the authentication.

## Front-end activation

After deployment, set the checkout function URL in the site script, for example:

\`\`\`js
window.HI_FASHION_COMMERCE = {
  checkoutEndpoint: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-checkout-session"
};
\`\`\`

Do not configure this until Stripe test mode, the webhook, shipping rate, gift-card email sender and Supabase policies have been tested. The frontend sends item IDs and quantities; the server loads prices, seller accounts, stock and gift-card values from the database.

## Test before accepting real money

- Use Stripe test mode and test cards.
- Test successful, failed, abandoned and delayed payments.
- Test inventory contention and expired-session stock release.
- Test seller accounts with incomplete verification and disabled payouts.
- Test gift-card issue only after a paid webhook; confirm the code is hashed in the database and delivered by email.
- Verify fees, VAT/tax treatment, shipping charges, refunds, chargebacks, consumer cancellation/returns rights, privacy and terms for every launch market.
