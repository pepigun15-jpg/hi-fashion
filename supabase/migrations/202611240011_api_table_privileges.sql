-- Explicit Data API privileges for this project.
-- The Supabase project was created with automatic API grants disabled,
-- so browser roles receive only the operations permitted by the RLS policies.

grant usage on schema public to anon, authenticated, service_role;

-- Public product storefront. RLS still limits rows to published products.
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

-- Customer and seller self-service reads/writes. RLS scopes every row to auth.uid().
grant select on public.seller_profiles to authenticated;
grant select, insert, update on public.customer_profiles to authenticated;
grant select, insert on public.seller_applications to authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select, insert, update, delete on public.wishlists to authenticated;

-- Public catalogue reads are further restricted by the enabled-source and active-product RLS policies.
grant select on public.catalogue_sources, public.catalogue_products to anon, authenticated;

-- Backend Edge Functions use the service_role key and perform their own authorization checks.
grant all privileges on table
  public.seller_profiles,
  public.products,
  public.orders,
  public.order_items,
  public.gift_cards,
  public.gift_card_transactions,
  public.stripe_webhook_events,
  public.wishlists,
  public.customer_profiles,
  public.seller_applications,
  public.catalogue_sources,
  public.catalogue_products,
  public.catalogue_sync_runs,
  public.catalogue_feed_cursors
to service_role;

-- Trigger-maintained search vectors are not callable as a browser RPC.
revoke all on function public.set_catalogue_product_search_vector() from public, anon, authenticated;
grant execute on function public.set_catalogue_product_search_vector() to service_role;

comment on table public.catalogue_feed_cursors is
  'Private resumable partner-feed checkpoints. Browser roles have no direct table privileges.';
