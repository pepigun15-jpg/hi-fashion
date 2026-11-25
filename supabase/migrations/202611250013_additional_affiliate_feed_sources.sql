-- Enable generic HTTPS CSV/TSV feed imports for additional approved affiliate networks.
-- This creates source metadata only; it does not imply approval or activate any feed.
insert into public.catalogue_sources(source_code,display_name,network,integration_type,is_enabled,last_sync_status)
values
  ('rakuten','Rakuten Advertising product feeds','Rakuten Advertising','product_feed',false,'not_configured'),
  ('impact','Impact.com product feeds','Impact.com','product_feed',false,'not_configured'),
  ('admitad','Admitad product feeds','Admitad','product_feed',false,'not_configured'),
  ('partnerize','Partnerize product feeds','Partnerize','product_feed',false,'not_configured'),
  ('tradedoubler','TradeDoubler product feeds','TradeDoubler','product_feed',false,'not_configured'),
  ('tradetracker','TradeTracker product feeds','TradeTracker','product_feed',false,'not_configured'),
  ('avantlink','AvantLink product feeds','AvantLink','product_feed',false,'not_configured'),
  ('commission_factory','Commission Factory product feeds','Commission Factory','product_feed',false,'not_configured'),
  ('flexoffers','FlexOffers product feeds','FlexOffers','product_feed',false,'not_configured'),
  ('webgains','Webgains product feeds','Webgains','product_feed',false,'not_configured'),
  ('adtraction','Adtraction product feeds','Adtraction','product_feed',false,'not_configured'),
  ('linkconnector','LinkConnector product feeds','LinkConnector','product_feed',false,'not_configured'),
  ('shareasale','ShareASale product feeds','ShareASale','product_feed',false,'not_configured')
on conflict(source_code) do nothing;
