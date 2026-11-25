import { chromium } from "playwright";

const base = "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));

async function openHome() {
  await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
}
async function clickAndCheck(selector, expected) {
  await openHome();
  const item = page.locator(selector).first();
  if (await item.count() === 0) throw new Error("Missing homepage control: " + selector);
  console.log("Testing homepage control:", selector, "from", page.url(), "href", await item.getAttribute("href"), "text", await item.textContent());
  await item.click();
  try {
    await page.waitForURL(url => {
    if (!url.pathname.endsWith("/marketplace.html")) return false;
    return expected(url);
    }, { timeout: 8000 });
  } catch (error) {
    throw new Error("Navigation failed for " + selector + "; current URL: " + page.url() + "; " + error.message);
  }
}
const checks = [
  ['a[href="#women"]', u => u.searchParams.get("search") === "Women"],
  ['a[href="#men"]', u => u.searchParams.get("search") === "Men"],
  ['a[href="#baby-kids"]', u => u.searchParams.get("search")?.toLowerCase().includes("baby")],
  ['a[href="#pets"]', u => u.searchParams.get("search") === "Pets"],
  ['a[href="#all-categories"]', u => u.hash === "#departments"],
  ['a[href="#jewellery"]', u => u.searchParams.get("search") === "Jewellery"],
  ['a[href="#military-tactical"]', u => u.searchParams.get("search")?.toLowerCase().includes("military")],
  ['a[href="#shoes"]', u => u.searchParams.get("search") === "Shoes"],
  ['a[href="#bags-accessories"]', u => u.searchParams.get("search")?.toLowerCase().includes("accessories")],
  ['a[href="#vintage-preowned"]', u => u.searchParams.get("search")?.toLowerCase().includes("vintage")],
  ['a[href="#new-collections-2027"]', u => u.searchParams.get("search")?.includes("2027")],
  ['a[href="#seasons"]', u => u.hash === "#seasonal-shop"],
  ['a[href="#global-brands"]', u => u.hash === "#brands"],
  ['a[href="#gift-cards"]', u => u.hash === "#gift-cards"],
  ['a[href="#season-spring"]', u => u.searchParams.get("search") === "spring"],
  ['a[href="#season-summer"]', u => u.searchParams.get("search") === "summer"],
  ['a[href="#season-autumn"]', u => u.searchParams.get("search") === "autumn"],
  ['a[href="#season-winter"]', u => u.searchParams.get("search") === "winter"],
  ['.b-nike', u => u.searchParams.get("search")?.toLowerCase().includes("nike")],
  ['.go', u => u.searchParams.get("search")?.length > 2],
  ['a.loc', u => u.hash === "#store-network"],
  ['a[data-i="sell"]', u => u.hash === "#seller"],
  ['a[data-i="brand"]', u => u.hash === "#brands"],
  ['a[data-i="gcat"]', u => u.hash === "#global-catalogue"],
  ['a[data-i="newa"]', u => u.hash === "#new-arrivals"]
];
for (const [selector, expected] of checks) await clickAndCheck(selector, expected);

await openHome();
await page.locator('.icons a[aria-label="Search"]').click();
await page.waitForURL(url => url.pathname.endsWith("/marketplace.html") && url.hash === "#search", { timeout: 8000 });

await openHome();
await page.locator('.icons a[aria-label="Account"]').click();
await page.waitForURL(url => url.pathname.endsWith("/marketplace.html") && url.searchParams.get("open") === "account", { timeout: 8000 });
if (!(await page.locator("#accountDrawer").isVisible())) throw new Error("Account icon did not open the account panel.");

await openHome();
await page.locator('.icons a[aria-label="Bag"]').click();
await page.waitForURL(url => url.pathname.endsWith("/marketplace.html") && url.searchParams.get("open") === "cart", { timeout: 8000 });
if (!(await page.locator("#commerceCart").isVisible())) throw new Error("Bag icon did not open the cart panel.");

await page.goto(base + "/marketplace.html", { waitUntil: "domcontentloaded" });
await page.locator("#accountToggle").click();
if (!(await page.locator("#accountDrawer").isVisible())) throw new Error("Marketplace account button failed.");
await page.locator("#closeAccount").click();
await page.locator("#cartToggle").click();
if (!(await page.locator("#commerceCart").isVisible())) throw new Error("Marketplace cart button failed.");
await page.locator("#closeCart").click();

await page.locator("#departmentSearch").fill("dress");
await page.locator("#searchAllMarkets").click();
await page.waitForTimeout(1200);
const status = (await page.locator("#catalogueStatus").textContent()) || "";
if (!status.trim()) throw new Error("Global catalogue search produced no status.");
const cards = await page.locator(".catalogue-product-card").count();
for (let i = 0; i < cards; i++) {
  const card = page.locator(".catalogue-product-card").nth(i);
  if (!(await card.locator(".catalogue-product-price").count())) throw new Error("A product card is missing its real price.");
  if (!(await card.locator('a.catalogue-product-cta[href^="https://"]').count())) throw new Error("A product card is missing its tracked merchant destination.");
}

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "domcontentloaded" });
if (pageErrors.length) throw new Error("Browser JavaScript errors: " + pageErrors.join(" | "));
console.log("Browser smoke tests passed:", checks.length + 7, "navigation and commerce interactions; live cards returned:", cards);
await browser.close();
