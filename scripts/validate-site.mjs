import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const files = ["index.html", "marketplace.html"];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hi-fashion-js-"));
let failures = 0;
function fail(message) { console.error("FAIL:", message); failures++; }
for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!scripts.length) fail(file + ": no inline scripts found");
  scripts.forEach((match, index) => {
    const target = path.join(temp, file.replace(/\W/g, "_") + "-" + index + ".js");
    fs.writeFileSync(target, match[1]);
    const check = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    if (check.status !== 0) fail(file + " inline script " + index + ": " + (check.stderr || check.stdout));
  });
  console.log("Checked inline JavaScript:", file, "(" + scripts.length + " scripts)");
}

const market = fs.readFileSync(path.join(root, "marketplace.html"), "utf8");
const ids = new Set([...market.matchAll(/\bid=["']([^"']+)["']/g)].map(x => x[1]));
const duplicateIds = [...market.matchAll(/\bid=["']([^"']+)["']/g)].map(x => x[1]).filter((id, i, all) => all.indexOf(id) !== i);
if (duplicateIds.length) fail("marketplace.html duplicate IDs: " + [...new Set(duplicateIds)].join(", "));
const staticHtml = market.split(/<script\b/i)[0];
const missing = [...staticHtml.matchAll(/href=["']#([^"']+)["']/g)].map(x => x[1]).filter(id => !ids.has(id));
if (missing.length) fail("marketplace.html broken in-page links: " + [...new Set(missing)].join(", "));
for (const id of ["productCatalogue", "global-catalogue", "seller", "store-network", "brands", "new-arrivals", "seasonal-shop", "gift-cards"]) {
  if (!ids.has(id)) fail("required marketplace destination missing: #" + id);
}
if (!market.includes('if(!cta||price===null||price===undefined||!Number.isFinite(Number(price))||!currency)return "";')) fail("product cards do not enforce a real price, currency and affiliate URL");
if (!market.includes('search-cj-catalogue') || !market.includes('search-ebay-catalogue')) fail("CJ/eBay live search endpoints missing");
if (!market.includes('requestedSearch=new URLSearchParams(window.location.search).get("search")')) fail("category deep-link search is not initialised");
if (market.includes("€119.00") || market.includes("€149.00") || market.includes("€189.00") || market.includes("€229.00")) fail("illustrative featured prices remain visible");

const registry = JSON.parse(fs.readFileSync(path.join(root, "data/partner-network-registry.json"), "utf8"));
if (!Array.isArray(registry.networks) || registry.networks.length < 10) fail("partner network prospect registry is incomplete");
if (registry.networks.some(x => x.status !== "prospect" && x.status !== "applied" && x.status !== "approved" && x.status !== "connected" && x.status !== "paused")) fail("unknown partner status found");
const retailers = JSON.parse(fs.readFileSync(path.join(root, "data/retailer-registry.seed.json"), "utf8"));
if (!Array.isArray(retailers.merchants) || retailers.merchants.length < 100) fail("retailer directory seed unexpectedly small");
console.log("Partner networks:", registry.networks.length, "| Directory merchants:", retailers.merchants.length);
fs.rmSync(temp, { recursive: true, force: true });
if (failures) process.exit(1);
console.log("HI FASHION static validation passed.");
