import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_BASE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (value: unknown, status=200) =>
  new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Authentication required." }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid session." }, 401);

    const allowedAdmins = (Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map(x => x.trim()).filter(Boolean);
    if (!allowedAdmins.includes(user.id)) return json({ error: "Administrator access required." }, 403);

    const body = await req.json();
    const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
    const decision = body?.decision;
    if (!applicationId || !["approved","rejected","reviewing"].includes(decision)) {
      return json({ error: "Provide an application ID and a valid review decision." }, 400);
    }

    const { data: application, error: applicationError } = await admin.from("seller_applications")
      .select("id,user_id,business_name,country_code,website,category,description,status")
      .eq("id", applicationId).maybeSingle();
    if (applicationError) throw applicationError;
    if (!application) return json({ error: "Seller application not found." }, 404);

    if (decision === "approved") {
      const { error: profileError } = await admin.from("seller_profiles").upsert({
        user_id: application.user_id,
        business_name: application.business_name,
        country_code: application.country_code,
        is_approved: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (profileError) throw profileError;
    }

    const { error: updateError } = await admin.from("seller_applications").update({
      status: decision,
      admin_notes: typeof body?.adminNotes === "string" ? body.adminNotes.slice(0,1200) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", application.id);
    if (updateError) throw updateError;
    return json({ success: true, applicationId, status: decision });
  } catch (error) {
    console.error("review-seller-application:", error);
    return json({ error: "Unable to review seller application." }, 500);
  }
});
