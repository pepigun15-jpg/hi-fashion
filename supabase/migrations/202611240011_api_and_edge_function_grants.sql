-- Explicit API and Edge Function privileges for projects that do not auto-grant
-- API access to newly created tables. Row Level Security policies remain enforced
-- for anon/authenticated; service_role is reserved for trusted Edge Functions.

grant usage on schema public to anon, authenticated, service_role;

-- Storefront account and seller-workspace access (RLS restricts rows and operations).
grant select on public.seller_profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select on public.products to anon;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select, insert, update on public.customer_profiles to authenticated;
grant select, insert on public.seller_applications to authenticated;
grant select, insert, update, delete on public.wishlists to authenticated;

-- Never expose payment instruments, gift-card hashes/codes or webhook event records
-- through the public API.
revoke all on public.gift_cards from anon, authenticated;
revoke all on public.gift_card_transactions from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;

-- Catalogue read API. Its RLS policies only reveal active rows from enabled sources.
grant select on public.catalogue_sources, public.catalogue_products to anon, authenticated;
grant execute on function public.search_catalogue_products(text,text,char,text,text,text,char,bigint,bigint,boolean,text,text,text,integer,integer)
  to anon, authenticated;

-- Trusted Edge Functions need server-side access to read/write commerce and catalogue
-- records after validating user sessions, administrator allowlists and provider webhooks.
grant all on public.seller_profiles, public.products, public.orders, public.order_items,
  public.gift_cards, public.gift_card_transactions, public.stripe_webhook_events,
  public.wishlists, public.customer_profiles, public.seller_applications,
  public.catalogue_sources, public.catalogue_products, public.catalogue_sync_runs,
  public.catalogue_feed_cursors
to service_role;

grant execute on function public.reserve_order_inventory(uuid) to service_role;
grant execute on function public.release_order_inventory(uuid) to service_role;
grant execute on function public.search_catalogue_products(text,text,char,text,text,text,char,bigint,bigint,boolean,text,text,text,integer,integer)
  to service_role;

-- No browser role may operate feed cursors or internal sync-run records.
revoke all on public.catalogue_feed_cursors from anon, authenticated;
revoke all on public.catalogue_sync_runs from anon, authenticated;
