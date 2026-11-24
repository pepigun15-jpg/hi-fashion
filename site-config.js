// Public browser configuration only. Never place service_role, Stripe secret,
// webhook secret, Resend API key or gift-card encryption key in this file.
window.HI_FASHION_SUPABASE_CONFIG = {
  url: "",
  anonKey: ""
};

const hiFashionSupabaseUrl = String(window.HI_FASHION_SUPABASE_CONFIG.url || "").replace(/\/+$/, "");
window.HI_FASHION_COMMERCE = {
  checkoutEndpoint: hiFashionSupabaseUrl
    ? hiFashionSupabaseUrl + "/functions/v1/create-checkout-session"
    : ""
};
