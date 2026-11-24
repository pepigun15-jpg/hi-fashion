// Public browser configuration only. The Supabase publishable/anon key is designed for browser use
// when Row Level Security is enabled. NEVER put service_role, Supabase secret, Stripe secret,
// Stripe webhook secret, Resend API key, or gift-card encryption key in this file.
window.HI_FASHION_SUPABASE_CONFIG = {
  url: "",
  anonKey: ""
};

// Checkout and seller Connect Edge Function URLs are derived from the Supabase project URL.
// Real checkout remains disabled server-side until all account, shipping, tax and Stripe checks pass.
window.HI_FASHION_COMMERCE = {
  checkoutEndpoint: ""
};
