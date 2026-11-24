-- A product SKU can repeat across different retailers. Keep each retailer's listing distinct.
alter table public.catalogue_products
  drop constraint if exists catalogue_products_source_code_external_id_retailer_country_key;

alter table public.catalogue_products
  add constraint catalogue_products_source_external_retailer_country_key
  unique(source_code, external_id, retailer, retailer_country);
