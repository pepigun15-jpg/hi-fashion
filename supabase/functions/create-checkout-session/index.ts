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
const env = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error("Missing server configuration: " + key);
  return value;
};
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe(env("STRIPE_SECRET_KEY"));
  let orderId: string | null = null;
  let reserved = false;

  try {
    if (Deno.env.get("COMMERCE_LIVE_ENABLED") !== "true") {
      return json({ error: "Live checkout remains disabled until tax, shipping, seller verification, legal terms and Stripe test transactions are approved." }, 503);
    }
    if (Deno.env.get("STRIPE_AUTOMATIC_TAX_ENABLED") !== "true") {
      return json({ error: "Stripe Tax must be configured and enabled before checkout." }, 503);
    }

    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Sign in before checkout." }, 401);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData.user;
    if (authError || !user?.email || !user.email_confirmed_at) {
      return json({ error: "A confirmed customer account is required." }, 401);
    }

    const body = await req.json();
    const buyer = body?.buyer ?? {};
    const buyerName = text(buyer.name, 120);
    const buyerEmail = user.email.toLowerCase();
    const address = text(buyer.address, 240);
    const country = text(buyer.country, 90);
    const postal = text(buyer.postalCode, 24);
    if (!buyerName || !address || !country || !postal) {
      return json({ error: "Complete the delivery name, address, country and postal code." }, 400);
    }
    if (buyer.email && text(buyer.email, 160).toLowerCase() !== buyerEmail) {
      return json({ error: "Checkout email must match your confirmed account email." }, 400);
    }

    if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 20) {
      return json({ error: "Cart must contain 1–20 items." }, 400);
    }

    const items: Array<{id:string; quantity:number; type:"product"|"gift"; recipient:string; recipientEmail:string; message:string}> = [];
    for (const row of body.items) {
      const id = text(row?.id, 80);
      const quantity = Number(row?.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) return json({ error: "Invalid cart item or quantity." }, 400);
      const type = row?.type === "gift" || row?.type === "gift_card" ? "gift" : "product";
      if (type === "gift") {
        if (!/^gift-(2500|5000|10000|20000)$/.test(id) || quantity !== 1) return json({ error: "Unsupported gift-card amount." }, 400);
        const recipientEmail = text(row?.recipientEmail, 160).toLowerCase();
        const recipient = text(row?.recipient, 100);
        if (!recipient || !emailOk(recipientEmail)) return json({ error: "Invalid gift-card recipient details." }, 400);
        items.push({ id, quantity, type, recipient, recipientEmail, message: text(row?.message, 300) });
      } else {
        if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return json({ error: "Only approved live product listings can be purchased." }, 400);
        items.push({ id, quantity, type, recipient: "", recipientEmail: "", message: "" });
      }
    }

    const hasGift = items.some(x => x.type === "gift");
    const hasProducts = items.some(x => x.type === "product");
    if (hasGift && hasProducts) return json({ error: "Gift cards must be purchased separately from physical products." }, 400);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const itemRows: Record<string, unknown>[] = [];
    let subtotal = 0;
    let shippingMinor = 0;
    let sellerId: string | null = null;
    let connectedAccountId: string | null = null;

    if (hasGift) {
      for (const item of items) {
        const amount = Number(item.id.slice(5));
        subtotal += amount;
        itemRows.push({
          product_id: null, line_type: "gift_card", name_snapshot: "HI FASHION Digital Gift Card",
          quantity: 1, unit_amount_minor: amount, currency: "EUR",
          recipient_name: item.recipient, recipient_email: item.recipientEmail, gift_message: item.message,
        });
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: "eur", unit_amount: amount,
            product_data: { name: "HI FASHION Digital Gift Card", description: "Digital gift card delivered after confirmed payment." },
          },
        });
      }
    } else {
      const ids = items.map(x => x.id);
      const { data: products, error: productError } = await admin.from("products")
        .select("id,seller_id,name,description,price_minor,currency,stock,is_published")
        .in("id", ids);
      if (productError) throw productError;
      if (!products || products.length !== new Set(ids).size) return json({ error: "One or more products are unavailable." }, 409);
      const sellers = [...new Set(products.map(p => p.seller_id))];
      if (sellers.length !== 1) return json({ error: "Checkout currently supports products from one seller at a time." }, 400);
      sellerId = sellers[0];

      const { data: seller, error: sellerError } = await admin.from("seller_profiles")
        .select("user_id,stripe_account_id,is_approved,charges_enabled,payouts_enabled")
        .eq("user_id", sellerId).maybeSingle();
      if (sellerError) throw sellerError;
      if (!seller?.is_approved || !seller.stripe_account_id || !seller.charges_enabled || !seller.payouts_enabled) {
        return json({ error: "This seller has not completed identity and payout verification." }, 409);
      }
      connectedAccountId = seller.stripe_account_id;

      for (const item of items) {
        const product = products.find(p => p.id === item.id);
        if (!product || !product.is_published || product.currency !== "EUR" || product.price_minor < 1 || product.stock < item.quantity) {
          return json({ error: "A product is unpublished, out of stock or not available in EUR." }, 409);
        }
        subtotal += product.price_minor * item.quantity;
        itemRows.push({
          product_id: product.id, line_type: "product", name_snapshot: product.name,
          quantity: item.quantity, unit_amount_minor: product.price_minor, currency: "EUR",
          recipient_name: null, recipient_email: null, gift_message: null,
        });
        lineItems.push({
          quantity: item.quantity,
          price_data: {
            currency: "eur", unit_amount: product.price_minor,
            product_data: { name: text(product.name, 120), description: text(product.description, 400) || undefined },
          },
        });
      }

      const rate = await stripe.shippingRates.retrieve(env("STRIPE_SHIPPING_RATE_ID"));
      if (!rate.active || rate.type !== "fixed_amount" || rate.fixed_amount?.currency !== "eur") {
        return json({ error: "An active fixed EUR shipping rate must be configured." }, 503);
      }
      shippingMinor = rate.fixed_amount.amount;
    }

    if (!Number.isSafeInteger(subtotal) || subtotal < 1 || subtotal > 100000000) return json({ error: "Order value is outside permitted limits." }, 400);
    const allowedCountries = (Deno.env.get("STRIPE_ALLOWED_SHIPPING_COUNTRIES") ?? "BG,DE,FR,IT,ES,NL,BE,AT,PL,RO,GR,CY,IE,PT,SE,DK,FI,CZ,HU,HR,SI,SK,LT,LV,EE,LU,MT,GB,US,CA,AU,NZ,AE,SA,JP,KR,SG,MY,TH,IN,TR")
      .split(",").map(x => x.trim().toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x));
    if (hasProducts && !allowedCountries.includes(country.toUpperCase())) throw new Error("Shipping country is not enabled.");

    const { data: order, error: orderError } = await admin.from("orders").insert({
      user_id: user.id, seller_id: sellerId, customer_email: buyerEmail, customer_name: buyerName,
      currency: "EUR", subtotal_minor: subtotal, shipping_minor: shippingMinor, tax_minor: 0,
      total_minor: subtotal + shippingMinor, status: "pending",
      shipping_address: hasProducts ? { line1: address, country, postal_code: postal } : {},
    }).select("id").single();
    if (orderError) throw orderError;
    orderId = order.id;

    const { error: itemError } = await admin.from("order_items").insert(itemRows.map(row => ({ ...row, order_id: order.id })));
    if (itemError) throw itemError;
    if (hasProducts) {
      const { error } = await admin.rpc("reserve_order_inventory", { p_order_id: order.id });
      if (error) throw error;
      reserved = true;
    }

    const appFeeBps = hasProducts ? Number(Deno.env.get("PLATFORM_COMMISSION_BPS") ?? "1000") : 0; // Approved 10% platform commission by default.
    if (!Number.isInteger(appFeeBps) || appFeeBps < 0 || appFeeBps > 3000) throw new Error("Platform commission must be set to 0–3000 basis points.");
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer_email: buyerEmail,
      client_reference_id: order.id,
      metadata: { order_id: order.id, customer_id: user.id, order_kind: hasGift ? "gift_card" : "marketplace" },
      line_items: lineItems,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      success_url: env("APP_BASE_URL") + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: env("APP_BASE_URL") + "/?checkout=cancelled",
      ...(hasProducts ? {
        shipping_address_collection: { allowed_countries: allowedCountries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
        shipping_options: [{ shipping_rate: env("STRIPE_SHIPPING_RATE_ID") }],
        payment_intent_data: {
          application_fee_amount: Math.floor(subtotal * appFeeBps / 10000),
          transfer_data: { destination: connectedAccountId! },
        },
      } : {}),
    };
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey: "hi-fashion-order-" + order.id });
    const { error: updateError } = await admin.from("orders").update({
      stripe_checkout_session_id: session.id, stripe_account_id: connectedAccountId,
    }).eq("id", order.id);
    if (updateError) throw updateError;
    return json({ checkoutUrl: session.url, orderId: order.id });
  } catch (error) {
    console.error("create-checkout-session:", error);
    if (orderId) {
      if (reserved) await admin.rpc("release_order_inventory", { p_order_id: orderId });
      await admin.from("orders").delete().eq("id", orderId).eq("status", "pending");
    }
    const message = error instanceof Error && error.message.startsWith("Missing server configuration")
      ? error.message : "Unable to start secure checkout. Check the account, cart and shipping setup.";
    return json({ error: message }, 400);
  }
});
