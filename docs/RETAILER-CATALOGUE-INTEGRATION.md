# HI FASHION — retailer catalogue integration

## Current repository audit

The website contains **176 retailer cards** in its global brand/store directory. These are outbound store links, not proof of a commercial integration or live product feed.

The current catalogue code has four data paths:
1. HI FASHION's own Supabase catalogue (catalogue_products).
2. CJ Affiliate product search (search-cj-catalogue).
3. eBay Browse API (search-ebay-catalogue).
4. Awin/CJ CSV feed import (import-retailer-feed), using resumable HTTPS CSV/TSV downloads.

The import function accepts only Awin and CJ feed sources, requires an authenticated user listed in ADMIN_USER_IDS, validates HTTPS feed URLs, imports in batches, and marks stale products inactive only after a complete feed run.

## Important distinction

A store appearing in the 176-link directory does not mean HI FASHION has permission to copy its catalogue, images, prices, stock, or shipping promises. Each merchant must be connected through an approved affiliate programme, product feed, API, seller agreement, or other documented permission. Do not scrape protected stores or bypass bot controls.

The catalogue should show live product offers only when the source provides a valid product record and a permitted destination/tracking link. Otherwise show the store as a directory link only.

## Integration status and official onboarding

| Merchant / network | Official route | What HI FASHION needs |
|---|---|---|
| Awin advertisers | https://www.awin.com/ | Approved Awin publisher account, advertiser programme approval, product feed download URL/API access |
| CJ Affiliate advertisers | https://www.cj.com/ and https://developers.cj.com/ | Active publisher account, advertiser approval where required, CJ Personal Access Token, Company ID, Publisher ID; product-feed API or authorised CSV feed |
| eBay | https://partnernetwork.ebay.com/ and https://developer.ebay.com/api-docs/buy/browse/overview.html | eBay developer application credentials, production Browse API access, approved EPN campaign ID |
| Amazon | https://affiliate-program.amazon.com/creatorsapi/docs/ | Associates approval for each target marketplace, qualifying sales/API eligibility, registered API credentials and compliant tracking |
| FARFETCH | https://www.farfetch.com/pag1987.aspx | Affiliate application to affiliates@farfetch.com; approval and access to its daily product feeds |
| MYTHERESA | https://www.mytheresa.com/gb/en/affiliates | Apply through CJ or Rakuten; approval and product-feed access |
| NET-A-PORTER | https://www.net-a-porter.com/en-at/content/affiliates/ | Invitation-only affiliate approval and product feed access |
| MR PORTER | https://www.mrporter.com/en-gb/content/affiliates/ | Affiliate application/approval and product feed |
| Other stores in the directory | Merchant's official affiliate/partner/API page | Individual approval and permitted feed/API/link terms |

Programme approval is not guaranteed. An application or a public store URL is not an active integration.

## Existing Supabase secrets

Set secrets only in the Supabase project Edge Function secrets manager. Never put these in index.html, site-config.js, GitHub source, or browser JavaScript.

### CJ direct product search
- CJ_PERSONAL_ACCESS_TOKEN
- CJ_COMPANY_ID
- CJ_PUBLISHER_ID

### eBay Browse API
- EBAY_CLIENT_ID
- EBAY_CLIENT_SECRET
- EBAY_AFFILIATE_CAMPAIGN_ID (approved 10-digit campaign ID)
- Optional: EBAY_AFFILIATE_REFERENCE_ID
- Optional: EBAY_ENVIRONMENT=production

### Awin feed import
- AWIN_FEED_URL or AWIN_FEED_<FEED_ID>_URL
- Optional: AWIN_FEED_BEARER_TOKEN
- Optional: AWIN_DEFAULT_COUNTRY
- Optional: AWIN_DEFAULT_CURRENCY

### CJ feed import
- CJ_FEED_URL or CJ_FEED_<FEED_ID>_URL
- Optional: CJ_FEED_BEARER_TOKEN
- Optional: CJ_DEFAULT_COUNTRY
- Optional: CJ_DEFAULT_CURRENCY

The feed importer also requires the existing Supabase service configuration and ADMIN_USER_IDS. Feed URLs must use HTTPS. Large feeds should support byte-range requests so the importer can resume safely.

## Feed refresh and operations

1. Obtain a feed URL from the approved network/merchant account.
2. Add the URL and any required token as private Supabase secrets.
3. Sign in as an administrator and invoke POST /functions/v1/import-retailer-feed with JSON: {"source_code":"awin","feed_id":"merchant-or-feed-name"} or {"source_code":"cj","feed_id":"merchant-or-feed-name"}.
4. Repeat while the response has complete:false; stop when complete:true.
5. Inspect the corresponding sync run and catalogue source status in Supabase.
6. Schedule a server-side refresh cadence appropriate to the merchant's feed update policy. Do not run simultaneous imports for the same source/feed ID.
7. Alert an administrator on failed or partial syncs; never mark a feed healthy solely because the HTTP request succeeded.

## Product data requirements

For each imported offer, retain as much as the approved source supplies:
- source/network and advertiser/merchant identity;
- stable source product ID and SKU/GTIN where available;
- title, brand, description, category and gender;
- image URL, product URL and affiliate deep link;
- native price/currency and sale price;
- stock/availability and size/colour variants;
- retailer country and explicit ship-to countries;
- shipping charge, delivery estimate, duties/taxes and returns URL only when the merchant provides them;
- source timestamp and last successful sync time.

Do not infer worldwide shipping, stock availability, authenticity, or dispatch location from a store's homepage. Do not display a fake price, image, stock badge, delivery promise, or affiliate tracking status.

## Catalogue and checkout model

- External affiliate offers send the customer to the merchant's own checkout using the approved tracking/deep link. HI FASHION must not imply that it processes or fulfils those orders.
- HI FASHION marketplace sellers use the separate first-party seller/cart/Stripe Connect flow.
- The agreed 10% HI FASHION seller commission applies to first-party seller product subtotal, excluding shipping and tax. It is not the affiliate network commission and must not be applied to an external merchant checkout.
- Never mix external affiliate offers and first-party seller items into a single payment unless a legally and technically supported multi-merchant checkout has been implemented and tested.

## Known implementation limitation

The existing CJ search currently returns a limited field set and leaves some catalogue attributes (notably image and detailed shipping/availability) blank when the CJ response does not provide them in the selected query. The eBay path depends on approved production credentials and EPN campaign configuration. The Awin/CJ feed importer is implemented, but no merchant feed becomes live until valid feed URLs and approvals are supplied and a complete import succeeds.

## Acceptance checks before public launch

- Search across local catalogue, CJ, eBay and imported Awin/CJ feeds works without hiding global offers when a user has enabled location.
- Every external product card has a source identity and valid HTTPS merchant/affiliate destination.
- Country-specific eligibility is based on source data, not assumptions.
- Prices/currencies and availability are fresh enough for the source's policy.
- Affiliate disclosure is visible near affiliate product links.
- Failed or stale feeds are excluded or clearly marked; no stale stock/price promises.
- Product images are loaded only from permitted feed/API image URLs.
- No secret appears in public source or browser network requests.
- Mobile, pagination, filters, search, keyboard access and error states pass tests.

## Expanded worldwide partner-network coverage

HI FASHION should apply to and integrate with multiple networks rather than depend on one programme. These networks provide access to many advertisers, but they do not automatically grant access to every merchant or every product feed.

Priority network onboarding queue:

| Network | Primary use | Integration status |
|---|---|---|
| Awin | Global fashion, sportswear, footwear, lifestyle, home and retail advertisers | Existing feed importer supports Awin CSV/TSV; account, advertiser approvals and feed URLs still required |
| CJ Affiliate | Global brands and retailers, including fashion and marketplace advertisers | Existing CJ search and feed import paths; production credentials and approved advertiser feeds required |
| eBay Partner Network / Browse API | Broad marketplace assortment, new and pre-owned goods | Existing search path; production API and affiliate approval required |
| Rakuten Advertising | Fashion, department stores, luxury, beauty and lifestyle retailers | Candidate network; account, programme approvals and product-feed/API access required |
| Impact.com | Fashion, outdoor, sports, baby, pet and general retail programmes | Candidate network; merchant-by-merchant approval and catalogue access required |
| Partnerize | International and regional fashion/luxury merchants, including Gulf retailers | Candidate network; merchant approval and product feed/API required |
| Admitad | Strong regional reach including India and cross-border ecommerce | Candidate network; programme approval and feed/API access required |
| TradeDoubler | European and international advertisers | Candidate network; account, programme approval and feeds required |
| TradeTracker | Regional European and international advertisers | Candidate network; account, advertiser approval and feeds required |
| AvantLink | Outdoor, adventure, apparel and equipment retailers | Candidate network; advertiser approval and feeds required |
| Sovrn Commerce / Skimlinks | Monetisation and merchant-link discovery where supported | Candidate route; confirm product-level data, terms, tracking and country coverage before treating as a catalogue feed |
| Direct retailer APIs / partner portals | Merchants not available through networks | Individual written permission, API/feed documentation and access credentials required |

Research references for network onboarding:
- Awin describes a network of 30,000+ brands and 1M+ approved partners: https://www.awin.com/us/
- CJ Affiliate: https://www.cj.com/
- Rakuten Advertising: https://rakutenadvertising.com/
- Impact: https://impact.com/
- Partnerize: https://partnerize.com/
- Admitad: https://www.admitad.com/
- TradeDoubler: https://www.tradedoubler.com/
- TradeTracker: https://tradetracker.com/
- AvantLink: https://www.avantlink.com/
- eBay Partner Network: https://partnernetwork.ebay.com/

These network scale figures and public directories describe potential advertiser reach, not confirmed HI FASHION access.

## Product verticals to include in the global catalogue

Create independent navigable catalogue departments and independent product taxonomy for:

1. Women: clothing, modest fashion, occasionwear, shoes, handbags, jewellery, accessories.
2. Men: clothing, tailoring, streetwear, shoes, watches, jewellery, accessories.
3. Indian fashion and jewellery: sarees, lehengas, salwar suits, kurtas, sherwanis, ethnic footwear, bangles, bridal jewellery, gold/silver/fashion jewellery, gemstones and accessories.
4. Arab and Middle Eastern fashion: abayas, kaftans, jalabiyas, thobes, hijabs, modest occasionwear, oud-related fashion accessories where lawful, and regional jewellery.
5. Jewellery and watches: fine jewellery, gold, silver, diamonds, gemstones, pearls, costume jewellery, watches and handmade artisan pieces. Product material and authenticity claims must come from the merchant.
6. Military-inspired and tactical apparel: outdoor clothing, boots, backpacks, utility garments, workwear, camping and survival equipment. Restrict the catalogue to lawful apparel and ordinary outdoor equipment; do not list prohibited weapons, weapon parts, ammunition or restricted self-defence products.
7. Sports and outdoor: activewear, hiking, camping, travel, fitness, cycling and performance equipment.
8. Baby: newborn, infant and toddler clothing, footwear, sleepwear, accessories and nursery essentials.
9. Kids and teens: clothing, shoes, schoolwear, accessories and occasionwear.
10. Pet fashion and supplies: dog/cat clothing, collars, harnesses, beds, travel accessories, grooming and ordinary pet supplies.
11. Vintage and pre-owned: authenticated or clearly described second-hand clothing, shoes, bags, watches and jewellery; condition grading and seller identity required.
12. Bags, luggage, eyewear, beauty and lifestyle accessories where supported by the retailer feed and site policies.

Every department needs its own category buttons, filters, season mapping, landing page and search aliases. Products may appear in more than one relevant collection but must retain one canonical product/offer identity.

## Priority merchant discovery queue (not yet connected)

Use the existing 176-store directory as the base, deduplicate by canonical merchant domain, and add candidate merchants by department. Examples for partner-programme research and application:

- India / South Asia: Myntra, AJIO, Tata CLiQ, Nykaa Fashion, Tanishq, CaratLane, BlueStone, Kalyan Jewellers, Malabar Gold & Diamonds, Sabyasachi, Fabindia.
- Gulf / Arab fashion: Ounass, Namshi, 6thStreet, Sivvi, Level Shoes, Tryano, regional abaya and jewellery merchants.
- Tactical / outdoor: 5.11 Tactical, Helikon-Tex, UF PRO, Decathlon, Sportsman's Warehouse, Cabela's, Bass Pro Shops, REI, Backcountry, Sports Direct.
- Baby / kids: Carter's, Mothercare, JoJo Maman Bébé, Next, H&M Kids, Zara Kids, The Children's Place, Vertbaudet.
- Pets: Zooplus, Fressnapf, Petco, Pets at Home, Chewy, PetSmart.
- Luxury / global fashion: retain and expand the current directory with verified regional variants and country-specific storefronts.

The merchant list is a prospecting queue, not a statement that these brands offer a public affiliate programme, ship worldwide, or have approved HI FASHION. Verify each merchant's current partner terms and country delivery policies before activation.

## Merchant registry requirements

Create or maintain a central retailer registry with one row per merchant and country programme:

- canonical merchant ID and canonical domain;
- display name and brand asset source/permission;
- department/category tags and supported product types;
- merchant headquarters/dispatch regions only when confirmed;
- supported destination countries and excluded regions;
- affiliate network and advertiser/programme ID;
- integration type: directory-only, approved deep link, API search, product feed, marketplace seller;
- approval status: prospect, applied, approved, credentials pending, connected, paused, rejected;
- feed/API URL reference stored privately, never exposed to browser;
- refresh cadence, last successful sync, last error, feed health;
- allowed image/price/content usage and attribution rules;
- return-policy URL, delivery policy URL, customer-support route;
- date of last verification and evidence/source URL.

Do not label a retailer "verified", "secure", "worldwide shipping" or "connected" until the relevant evidence is stored and reviewed. A retailer's own checkout remains responsible for external affiliate orders.

## Implementation sequence

1. Audit and deduplicate all existing 176 retailer cards; preserve their URLs and regional storefront variants.
2. Populate the merchant registry with the existing stores and assign departments.
3. Add the missing department navigation and category taxonomy above.
4. Apply to the partner networks, beginning with Awin, CJ, eBay, Admitad, Impact and Partnerize; apply to individual merchants in parallel.
5. Connect only approved product feeds/APIs and test each source independently.
6. Add a source health dashboard and sync monitoring; isolate failed feeds without taking other merchants offline.
7. Expand by region and department as approvals arrive.
8. Run destination-country and shipping tests before presenting a product as deliverable to a customer.

## Launch truthfulness

"All possible stores" is an ongoing acquisition target, not a finite technical setting. No platform can guarantee every online store worldwide or that every merchant ships to every country. HI FASHION should continuously add merchants that meet the integration, permission, product-data and customer-safety requirements above.


## 2026-11-25 partner discovery expansion and deep-link acceptance

### Candidate partner programme registry (prospects, not active connections)

The following networks are candidates for publisher applications and approved product-feed/API onboarding. Inclusion means only that the network is a prospect; it does not mean HI FASHION has an account, approval, advertiser access, feed credentials or live products.

| Network | Public partner entry point | Candidate coverage | Current HI FASHION status |
|---|---|---|---|
| Awin | https://www.awin.com/ | Europe and global retail, fashion, beauty, home | Feed importer supports Awin CSV/TSV; publisher/advertiser approvals and feed secrets required |
| CJ Affiliate | https://www.cj.com/ | Global fashion, luxury, lifestyle, beauty | Search and feed importer code present; credentials and advertiser approvals required |
| eBay Partner Network | https://partnernetwork.ebay.com/ | Global marketplace, new and pre-owned | Search adapter code present; production Browse API and EPN campaign approval required |
| Rakuten Advertising | https://rakutenadvertising.com/ | Global retail and fashion | Prospect; adapter not confirmed in code |
| Impact.com | https://impact.com/ | Global brands, fashion, sports, baby, pets | Prospect; adapter not confirmed in code |
| Partnerize | https://partnerize.com/ | Global and regional retail/fashion | Prospect; adapter not confirmed in code |
| Admitad | https://www.admitad.com/ | Europe, India and cross-border retail | Prospect; adapter not confirmed in code |
| TradeDoubler | https://www.tradedoubler.com/ | Europe and international advertisers | Prospect; adapter not confirmed in code |
| TradeTracker | https://tradetracker.com/ | Europe and selected international markets | Prospect; adapter not confirmed in code |
| AvantLink | https://www.avantlink.com/ | Outdoor, adventure, apparel and equipment | Prospect; adapter not confirmed in code |
| Sovrn Commerce / Skimlinks | https://www.sovrn.com/commerce/ and https://www.skimlinks.com/ | Merchant link monetisation and supported commerce data | Prospect; confirm product-data/feed rights before catalogue integration |
| Direct merchant partnerships | Merchant-specific partner/API portals | Any department or region | Requires written permission, documentation, credentials and feed/API testing |

### Merchant acquisition queue

Start applications and programme discovery with fashion/luxury merchants, then add region-specific partners. Candidate merchants to verify individually include:
- Global/luxury: FARFETCH, NET-A-PORTER, MR PORTER, MYTHERESA, SSENSE, LUISAVIAROMA, REVOLVE, Shopbop, GILT.
- India/South Asia: Myntra, AJIO, Tata CLiQ, Nykaa Fashion, Tanishq, CaratLane, BlueStone, Kalyan Jewellers, Malabar Gold & Diamonds, Fabindia.
- Gulf/Middle East: Ounass, Namshi, 6thStreet, Sivvi, Level Shoes, Tryano and regional abaya/jewellery merchants.
- Sports/outdoor/tactical apparel: Decathlon, 5.11 Tactical, Helikon-Tex, UF PRO, REI, Backcountry, Sports Direct, Cabela's and Bass Pro Shops. Only lawful apparel and ordinary outdoor goods are in scope.
- Baby/kids: Carter's, Mothercare, JoJo Maman Bébé, Next, H&M Kids, Zara Kids, The Children's Place and Vertbaudet.
- Pets: Zooplus, Fressnapf, Petco, Pets at Home, Chewy and PetSmart.

Do not assume a public affiliate programme exists, is open to this publisher, supplies product feeds, or ships to every destination. Record each merchant's current evidence, approval state, country programme, feed permission, image-use terms and delivery restrictions before showing product offers.

### Category deep-link behaviour

- The luxury landing page category route now links to the marketplace live-search page with a URL-encoded search term.
- The marketplace page reads the `search` query parameter and invokes its existing catalogue search handler.
- Search results can come from HI FASHION's Supabase catalogue, CJ Affiliate and eBay only when those sources are configured and return records.
- Category navigation must never render invented price/product cards as live offers. Existing sample/demo cards are not sale listings and must remain labelled as samples or be hidden from live catalogue results.

### Current limitations and required activation inputs

- No verified evidence currently establishes active Awin, CJ or eBay production credentials, approved advertiser feed URLs, completed feed imports or a live inventory count.
- No implementation is confirmed for Rakuten, Impact, Partnerize, Admitad, TradeDoubler, TradeTracker, AvantLink, Sovrn or Skimlinks. They remain prospect entries until a supported adapter and approved data source are implemented.
- Real product prices and availability cannot be manufactured from the retailer directory. They require partner approval and data returned by a permitted feed/API.
- Before claiming that every button works, run a browser-based interaction test across desktop and mobile for every link, button, filter, category, language selector, location control, account, cart, seller form and external product link. Record pass/fail evidence; GitHub source inspection alone is not a browser test.
- Before enabling first-party checkout, verify seller approval, Stripe Connect account readiness, inventory reservation, server-side price checks, shipping address, webhook signature handling, tax/shipping rules and test-mode end-to-end purchase. Affiliate offers continue to use the merchant's own checkout.
