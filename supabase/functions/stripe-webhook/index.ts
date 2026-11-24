import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const b64 = (bytes: Uint8Array) => {
  let result = "";
  for (const value of bytes) result += String.fromCharCode(value);
  return btoa(result);
};
const fromB64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function hashCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function makeGiftCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(20));
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    let part = "";
    for (let j = 0; j < 5; j++) part += alphabet[random[i * 5 + j] % alphabet.length];
    parts.push(part);
  }
  return "HIF-" + parts.join("-");
}
async function encryptCode(code: string) {
  const bytes = fromB64(Deno.env.get("GIFT_CARD_ENCRYPTION_KEY")!);
  if (bytes.length !== 32) throw new Error("Gift card encryption key must decode to 32 bytes.");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(code));
  return b64(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}
async function decryptCode(value: string) {
  const bytes = fromB64(Deno.env.get("GIFT_CARD_ENCRYPTION_KEY")!);
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
  const encoded = fromB64(value);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encoded.slice(0, 12) }, key, encoded.slice(12));
  return new TextDecoder().decode(plain);
}
async function deliverGiftCard(card: Record<string, any>, code: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("GIFT_CARD_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("Gift card email sender is not configured.");
  const clean = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, "");
  const html = '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;background:#101811;color:#f0d27b;padding:32px;border:1px solid #c6a45a">' +
    '<h1>HI FASHION</h1><h2>Your digital gift card</h2><p>Hello ' + clean(card.recipient_name) + ',</p>' +
    '<p>Your gift card is ready to use.</p><p style="font-size:24px;letter-spacing:3px;background:#080e0a;padding:18px;text-align:center">' + code + '</p>' +
    '<p>Value: ' + (card.initial_balance_minor / 100).toFixed(2) + ' ' + clean(card.currency) + '</p><p>' + clean(card.gift_message) + '</p>' +
    '<p>Keep this code private. It can be redeemed only through HI FASHION secure checkout.</p></div>';
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [card.recipient_email], subject: "Your HI FASHION digital gift card", html }),
  });
  if (!response.ok) throw new Error("Gift card email delivery failed.");
  const { error } = await admin.from("gift_cards").update({ delivered_at: new Date().toISOString() }).eq("id", card.id);
  if (error) throw error;
}
async function issueGiftCards(orderId: string) {
  const { data: items, error } = await admin.from("order_items")
    .select("id,unit_amount_minor,currency,recipient_name,recipient_email,gift_message")
    .eq("order_id", orderId).eq("line_type", "gift_card");
  if (error) throw error;
  for (const item of items ?? []) {
    const { data: existing, error: lookupError } = await admin.from("gift_cards")
      .select("*").eq("order_item_id", item.id).maybeSingle();
    if (lookupError) throw lookupError;
    let card = existing;
    let code = "";
    if (!card) {
      code = makeGiftCode();
      const { data: inserted, error: insertError } = await admin.from("gift_cards").insert({
        order_id: orderId, order_item_id: item.id, code_hash: await hashCode(code),
        encrypted_code: await encryptCode(code), currency: item.currency,
        initial_balance_minor: item.unit_amount_minor, balance_minor: item.unit_amount_minor,
        recipient_name: item.recipient_name, recipient_email: item.recipient_email, gift_message: item.gift_message,
      }).select("*").single();
      if (insertError) throw insertError;
      card = inserted;
      const { error: transactionError } = await admin.from("gift_card_transactions").insert({
        gift_card_id: card.id, order_id: orderId, transaction_type: "issued",
        amount_minor: item.unit_amount_minor, currency: item.currency, reference: "order:" + orderId,
      });
      if (transactionError) throw transactionError;
    } else if (card.delivered_at) {
      continue;
    } else if (card.encrypted_code) {
      code = await decryptCode(card.encrypted_code);
    } else {
      throw new Error("Gift card delivery code cannot be recovered.");
    }
    await deliverGiftCard(card, code);
  }
}
async function handleEvent(event: Stripe.Event) {
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const { error } = await admin.from("seller_profiles").update({
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      updated_at: new Date().toISOString(),
    }).eq("stripe_account_id", account.id);
    if (error) throw error;
    return;
  }
  if (!event.type.startsWith("checkout.session.")) return;
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.order_id;
  if (!orderId) return;

  if ((event.type === "checkout.session.completed" && session.payment_status === "paid") ||
      event.type === "checkout.session.async_payment_succeeded") {
    const { error } = await admin.from("orders").update({
      status: "paid",
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      total_minor: session.amount_total ?? undefined,
      tax_minor: session.total_details?.amount_tax ?? 0,
      shipping_minor: session.total_details?.amount_shipping ?? undefined,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", orderId).eq("status", "pending");
    if (error) throw error;
    await issueGiftCards(orderId);
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const status = event.type === "checkout.session.expired" ? "cancelled" : "payment_failed";
    const { error } = await admin.from("orders").update({ status, updated_at: new Date().toISOString() })
      .eq("id", orderId).eq("status", "pending");
    if (error) throw error;
    const { error: releaseError } = await admin.rpc("release_order_inventory", { p_order_id: orderId });
    if (releaseError) throw releaseError;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const signature = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider,
    );
  } catch (error) {
    console.error("Stripe signature validation failed:", error);
    return new Response("Bad signature", { status: 400 });
  }
  try {
    const { data: alreadyProcessed, error: lookupError } = await admin.from("stripe_webhook_events")
      .select("event_id").eq("event_id", event.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (alreadyProcessed) return Response.json({ received: true, duplicate: true });
    await handleEvent(event);
    const { error } = await admin.from("stripe_webhook_events").insert({ event_id: event.id, event_type: event.type });
    if (error && error.code !== "23505") throw error;
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error);
    return new Response("Webhook processing failed; retry is safe.", { status: 500 });
  }
});
