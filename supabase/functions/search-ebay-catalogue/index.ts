import { corsHeaders } from "../_shared/cors.ts";

const MARKETPLACE_BY_COUNTRY: Record<string, string> = {
  US: "EBAY_US", GB: "EBAY_GB", DE: "EBAY_DE", FR: "EBAY_FR",
  IT: "EBAY_IT", ES: "EBAY_ES", AU: "EBAY_AU", CA: "EBAY_CA",
  IE: "EBAY_IE", NL: "EBAY_NL", BE: "EBAY_BE", AT: "EBAY_AT",
  CH: "EBAY_CH", PL: "EBAY_PL", SG: "EBAY_SG", HK: "EBAY_HK",
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getEbayToken(clientId: string, clientSecret: string, baseUrl: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`eBay OAuth failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const token = await response.json();
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in || 7200) * 1000,
  };
  return cachedToken.accessToken;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    return Response.json({
      error: "eBay Browse API is not configured yet.",
      setup: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    }, { status: 424, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  if (!query) return Response.json({ error: "Enter a product search query." }, { status: 400, headers: corsHeaders });

  const country = (url.searchParams.get("country") || "").toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(country)) {
    return Response.json({ error: "Choose a valid delivery country before searching eBay.", configured: true, affiliateTrackingActive: false }, { status: 400, headers: corsHeaders });
  }
  const campaignId = Deno.env.get("EBAY_AFFILIATE_CAMPAIGN_ID") || "";
  if (!/^\\d{10}$/.test(campaignId)) {
    return Response.json({ error: "eBay Partner Network tracking is not configured. Add the approved 10-digit EPN campaign ID before showing eBay offers.", configured: false, affiliateTrackingActive: false, setup: ["EBAY_AFFILIATE_CAMPAIGN_ID"] }, { status: 424, headers: corsHeaders });
  }
  const marketplace = MARKETPLACE_BY_COUNTRY[country] || "EBAY_DE";
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 24), 50));
  const offset = Math.max(0, Math.min(Number(url.searchParams.get("offset") || 0), 9950));
  const postalCode = (url.searchParams.get("postalCode") || "").trim().slice(0, 20);
  const environment = (Deno.env.get("EBAY_ENVIRONMENT") || "production").toLowerCase();
  const baseUrl = environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

  try {
    const token = await getEbayToken(clientId, clientSecret, baseUrl);
    const apiUrl = new URL(`${baseUrl}/buy/browse/v1/item_summary/search`);
    apiUrl.searchParams.set("q", query);
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("offset", String(offset));
    apiUrl.searchParams.set("sort", "best_match");
    // Return only listings that eBay says can be delivered to the selected destination.
    apiUrl.searchParams.set("filter", `deliveryCountry:${country}`);

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "Accept": "application/json",
    };
    const contextParts: string[] = [];
    const affiliateReference = Deno.env.get("EBAY_AFFILIATE_REFERENCE_ID") || "hifashion";
    contextParts.push(`affiliateCampaignId=${campaignId}`);
    contextParts.push(`affiliateReferenceId=${affiliateReference.slice(0, 256)}`);
    const contextualLocation = postalCode
      ? `country%3D${country}%2Czip%3D${encodeURIComponent(postalCode)}`
      : `country%3D${country}`;
    contextParts.push(`contextualLocation=${contextualLocation}`);
    headers["X-EBAY-C-ENDUSERCTX"] = contextParts.join(",");

    const apiResponse = await fetch(apiUrl, { headers });
    const payload = await apiResponse.json();
    if (!apiResponse.ok) {
      return Response.json({
        error: "eBay product search returned an error.",
        providerStatus: apiResponse.status,
      }, { status: apiResponse.status >= 500 ? 502 : apiResponse.status, headers: corsHeaders });
    }

    const items = (payload.itemSummaries || []).map((item: any) => ({
      id: item.itemId,
      title: item.title || "eBay product",
      brand: item.brand || "",
      imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || "",
      price: item.price?.value ? Number(item.price.value) : null,
      currency: item.price?.currency || "",
      condition: item.condition || "",
      retailer: "eBay",
      retailerCountry: country,
      availability: "unknown",
      productUrl: item.itemAffiliateWebUrl || item.itemWebUrl || "",
      affiliateUrl: item.itemAffiliateWebUrl || "",
      seller: item.seller?.username || "",
      shipping: item.shippingOptions?.[0]?.shippingCost?.value
        ? Number(item.shippingOptions[0].shippingCost.value) : null,
      shippingCurrency: item.shippingOptions?.[0]?.shippingCost?.currency || "",
    }));

    return Response.json({
      provider: "eBay",
      query,
      marketplace,
      total: Number(payload.total || 0),
      offset,
      limit,
      affiliateTrackingActive: items.length > 0 && items.every((item: any) => /^https:\/\//i.test(item.affiliateUrl)),
      items,
    }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=45" } });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "eBay search failed.",
    }, { status: 502, headers: corsHeaders });
  }
});
