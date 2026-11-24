import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_BASE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Sign in first." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid user session." }, 401);

    const { data: profile, error } = await admin.from("seller_profiles")
      .select("user_id,country_code,stripe_account_id,is_approved")
      .eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!profile?.is_approved) return json({ error: "Seller approval is required before payout onboarding." }, 403);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: profile.country_code,
        email: user.email ?? undefined,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: "company",
        metadata: { supabase_user_id: user.id },
      }, { idempotencyKey: "hi-fashion-connect-" + user.id });
      accountId = account.id;
      const { error: saveError } = await admin.from("seller_profiles")
        .update({ stripe_account_id: accountId, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      if (saveError) throw saveError;
    }
    const base = Deno.env.get("APP_BASE_URL")!;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: base + "/?seller_onboarding=refresh",
      return_url: base + "/?seller_onboarding=return",
      type: "account_onboarding",
    });
    return json({ url: link.url });
  } catch (error) {
    console.error("create-connect-onboarding-link:", error);
    return json({ error: "Unable to create seller payout onboarding link." }, 500);
  }
});
