import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const files = ["index.html", "marketplace.html"];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hi-fashion-js-"));
let failures = 0;
function fail(message) { console.error("FAIL:", message); failures++; }
function inlineScripts(html) {
  const result = [];
  let cursor = 0;
  while (true) {
    const start = html.indexOf("<script", cursor);
    if (start < 0) break;
    const tagEnd = html.indexOf(">", start);
    const close = html.indexOf("</script>", tagEnd + 1);
    if (tagEnd < 0 || close < 0) { fail("Unclosed script element"); break; }
    const openingTag = html.slice(start, tagEnd + 1);
    if (!openingTag.includes("src=")) result.push(html.slice(tagEnd + 1, close));
    cursor = close + 9;
  }
  return result;
}
for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const scripts = inlineScripts(html);
  if (!scripts.length) fail(file + ": no inline scripts found");
  scripts.forEach((content, index) => {
    const target = path.join(temp, file.replaceAll("/", "_") + "-" + index + ".js");
    fs.writeFileSync(target, content);
    const check = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    if (check.status !== 0) fail(file + " inline script " + index + ": " + (check.stderr || check.stdout));
  });
  console.log("Checked inline JavaScript:", file, "(" + scripts.length + " scripts)");
}

const market = fs.readFileSync(path.join(root, "marketplace.html"), "utf8");
for (const id of ["productCatalogue", "global-catalogue", "seller", "store-network", "brands", "new-arrivals", "seasonal-shop", "gift-cards"]) {
  if (!market.includes('id="' + id + '"') && !market.includes("id='" + id + "'")) fail("required marketplace destination missing: #" + id);
}
if (!market.includes('if(!cta||price===null||price===undefined||!Number.isFinite(Number(price))||!currency)return "";')) fail("product cards do not enforce a real price, currency and affiliate URL");
if (!market.includes("search-cj-catalogue") || !market.includes("search-ebay-catalogue")) fail("CJ/eBay live search endpoints missing");
if (!market.includes('requestedSearch=new URLSearchParams(window.location.search).get("search")')) fail("category deep-link search is not initialised");
for (const fakePrice of ["€119.00", "€149.00", "€189.00", "€229.00"]) if (market.includes(fakePrice)) fail("illustrative featured price remains: " + fakePrice);
if (market.includes('<article class="commerce-product">')) fail("static sample commerce product cards remain visible");

const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const route of ['"#sell-with-us":"marketplace.html#seller"', '"#delivery-location":"marketplace.html#store-network"', '"#global-catalogue":"marketplace.html#global-catalogue"']) {
  if (!home.includes(route)) fail("homepage route missing: " + route);
}
if (!home.includes("SEARCH LIVE PRODUCTS & PRICES")) fail("homepage category route does not expose live product search");
for (const fakePrice of ["€119.00", "€149.00", "€189.00", "€229.00"]) if (home.includes(fakePrice)) fail("illustrative homepage price remains: " + fakePrice);
if (!home.includes("CHECK LIVE PRICE") || !home.includes('link.closest(".hf-reference-product")||link.closest(".card")')) fail("featured homepage offer cards are not routed to live catalogue search");

const registry = JSON.parse(fs.readFileSync(path.join(root, "data/affiliate-network-registry.json"), "utf8"));
if (!Array.isArray(registry.networks) || registry.networks.length < 10) fail("partner network prospect registry is incomplete");
if (registry.networks.some(x => typeof x.integration_status !== "string" || typeof x.adapter_status !== "string")) fail("partner adapter/status metadata missing");
const retailers = JSON.parse(fs.readFileSync(path.join(root, "data/retailer-registry.seed.json"), "utf8"));
if (!Array.isArray(retailers.merchants) || retailers.merchants.length < 100) fail("retailer directory seed unexpectedly small");
console.log("Partner networks:", registry.networks.length, "| Directory merchants:", retailers.merchants.length);
fs.rmSync(temp, { recursive: true, force: true });
if (failures) process.exit(1);
console.log("HI FASHION static validation passed.");
