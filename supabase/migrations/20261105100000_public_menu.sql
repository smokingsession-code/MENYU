-- Public menu data for diners, plus anonymous event recording.

-- Demo restaurants (the marketing-site demo) never send real WhatsApp
-- messages or show real payment codes. Only the service role sets this.
alter table public.restaurants add column is_demo boolean not null default false;

-- ---------------------------------------------------------------------------
-- get_public_menu: everything the diner page shows, and nothing else.
--   * hidden and deleted categories/items/options never appear
--   * plan limits apply: Free shows the first 30 items in menu order and no
--     item photos (nothing is deleted; it all returns on upgrade)
--   * payment codes, table names and specials only when the plan has them
-- Returns null for unknown, deleted or suspended menus.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_menu(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_plan text;
  v_features jsonb;
  v_limits jsonb;
  v_item_limit integer;
  v_photo_limit integer;
  v_categories jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_specials jsonb := '[]'::jsonb;
  v_has_lg boolean;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_branch from public.branches b where b.slug = lower(btrim(p_slug)) and b.deleted_at is null;
  if not found then
    return null;
  end if;
  select * into v_restaurant
    from public.restaurants r
   where r.id = v_branch.restaurant_id and r.deleted_at is null and not r.is_suspended;
  if not found then
    return null;
  end if;

  v_plan := private.effective_plan(v_restaurant.id);
  select p.features, p.limits into v_features, v_limits from public.plans p where p.code = v_plan;
  v_item_limit := (v_limits ->> 'items')::integer;
  v_photo_limit := (v_limits ->> 'itemPhotos')::integer;

  with visible as (
    select i.*,
           row_number() over (order by c.sort_order, c.created_at, i.sort_order, i.created_at) as position
      from public.items i
      join public.categories c on c.id = i.category_id
     where i.menu_id = v_branch.menu_id
       and i.deleted_at is null and not i.is_hidden
       and c.deleted_at is null and not c.is_hidden
  ),
  shown as (
    select v.*,
           case when v.photo is null then null
                else row_number() over (partition by v.photo is not null order by v.position) end as photo_rank
      from visible v
     where v_item_limit is null or v.position <= v_item_limit
  ),
  item_json as (
    select s.category_id, s.position, jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'name_lg', s.name_lg,
      'description', s.description,
      'description_lg', s.description_lg,
      'price', s.price_ugx,
      'photo', case when v_photo_limit is null or s.photo_rank <= v_photo_limit then s.photo end,
      'tags', to_jsonb(s.tags),
      'sold_out', exists (select 1 from public.sold_out so where so.branch_id = v_branch.id and so.item_id = s.id),
      'options', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', o.id, 'kind', o.kind, 'name', o.name, 'name_lg', o.name_lg, 'price', o.price_ugx
               ) order by o.kind desc, o.sort_order, o.created_at)
          from public.item_options o
         where o.item_id = s.id and o.deleted_at is null
      ), '[]'::jsonb)
    ) as item
      from shown s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'name_lg', c.name_lg,
           'items', (select jsonb_agg(ij.item order by ij.position) from item_json ij where ij.category_id = c.id)
         ) order by c.sort_order, c.created_at), '[]'::jsonb)
    into v_categories
    from public.categories c
   where c.menu_id = v_branch.menu_id and c.deleted_at is null and not c.is_hidden
     and exists (select 1 from item_json ij where ij.category_id = c.id);

  if coalesce((v_features ->> 'table_qr')::boolean, false) then
    select coalesce(jsonb_object_agg(t.code, t.label), '{}'::jsonb) into v_tables
      from public.tables t
     where t.branch_id = v_branch.id and t.deleted_at is null;
  end if;

  if coalesce((v_features ->> 'specials')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sp.id, 'title', sp.title, 'title_lg', sp.title_lg,
             'description', sp.description, 'description_lg', sp.description_lg,
             'price', sp.price_ugx, 'days', to_jsonb(sp.days),
             'start', to_char(sp.start_time, 'HH24:MI'), 'end', to_char(sp.end_time, 'HH24:MI'),
             'starts_on', sp.starts_on, 'ends_on', sp.ends_on,
             'items', coalesce((
               select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'name_lg', i.name_lg, 'quantity', si.quantity))
                 from public.special_items si join public.items i on i.id = si.item_id
                where si.special_id = sp.id and i.deleted_at is null
             ), '[]'::jsonb)
           ) order by sp.sort_order, sp.created_at), '[]'::jsonb)
      into v_specials
      from public.specials sp
     where sp.restaurant_id = v_restaurant.id
       and (sp.branch_id is null or sp.branch_id = v_branch.id)
       and sp.is_active and sp.deleted_at is null
       and (sp.ends_on is null or sp.ends_on >= v_today);
  end if;

  select coalesce(nullif(btrim(v_restaurant.description_lg), ''), null) is not null
      or exists (select 1 from public.categories c where c.menu_id = v_branch.menu_id and c.deleted_at is null and nullif(btrim(c.name_lg), '') is not null)
      or exists (select 1 from public.items i where i.menu_id = v_branch.menu_id and i.deleted_at is null
                   and (nullif(btrim(i.name_lg), '') is not null or nullif(btrim(i.description_lg), '') is not null))
    into v_has_lg;

  return jsonb_build_object(
    'version', v_restaurant.content_version,
    'plan', v_plan,
    'features', jsonb_build_object(
      'whatsapp_ordering', coalesce((v_features ->> 'whatsapp_ordering')::boolean, false),
      'momo_pay', coalesce((v_features ->> 'momo_pay')::boolean, false),
      'hide_footer', coalesce((v_features ->> 'hide_footer')::boolean, false),
      'specials', coalesce((v_features ->> 'specials')::boolean, false),
      'waiter_call', coalesce((v_features ->> 'waiter_call')::boolean, false),
      'feedback', coalesce((v_features ->> 'feedback')::boolean, false),
      'table_qr', coalesce((v_features ->> 'table_qr')::boolean, false)
    ),
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'description', v_restaurant.description,
      'description_lg', v_restaurant.description_lg,
      'logo', v_restaurant.logo,
      'cover', v_restaurant.cover,
      'brand_color', v_restaurant.brand_color,
      'cuisines', to_jsonb(v_restaurant.cuisines),
      'price_range', v_restaurant.price_range,
      'is_demo', v_restaurant.is_demo,
      'listed', v_restaurant.directory_status = 'approved'
                and coalesce((v_features ->> 'directory_listing')::boolean, false)
    ),
    'branch', jsonb_build_object(
      'id', v_branch.id,
      'slug', v_branch.slug,
      'name', v_branch.name,
      'area', v_branch.area,
      'address', v_branch.address,
      'lat', v_branch.lat,
      'lng', v_branch.lng,
      'phone', v_branch.phone,
      'whatsapp', v_branch.whatsapp,
      'opening_hours', v_branch.opening_hours,
      'accepts_dine_in', v_branch.accepts_dine_in,
      'accepts_takeaway', v_branch.accepts_takeaway,
      'accepts_delivery', v_branch.accepts_delivery,
      'delivery_note', v_branch.delivery_note,
      'momo', case when coalesce((v_features ->> 'momo_pay')::boolean, false)
                    and (v_branch.momo_mtn_code is not null or v_branch.momo_airtel_code is not null)
              then jsonb_build_object(
                'mtn_code', v_branch.momo_mtn_code, 'mtn_name', v_branch.momo_mtn_name,
                'airtel_code', v_branch.momo_airtel_code, 'airtel_name', v_branch.momo_airtel_name)
              end
    ),
    'categories', v_categories,
    'tables', v_tables,
    'specials', v_specials,
    'has_luganda', v_has_lg
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Live state for a cached menu page: the current version and sold-out items.
-- ---------------------------------------------------------------------------
create or replace function private.menu_live(p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', r.content_version,
    'sold_out', coalesce((select jsonb_agg(so.item_id) from public.sold_out so where so.branch_id = b.id), '[]'::jsonb)
  )
  from public.branches b
  join public.restaurants r on r.id = b.restaurant_id
  where b.id = p_branch_id;
$$;

-- ---------------------------------------------------------------------------
-- record_event: called by the rate-limited /api/e route (service role).
-- Validates the slug, item and table, stores the event, and returns the live
-- menu state so the page can refresh sold-out badges in the same request.
-- ---------------------------------------------------------------------------
create or replace function public.record_event(
  p_slug text,
  p_type text,
  p_table text default null,
  p_item uuid default null,
  p_session text default null,
  -- Rate-limit key (hashed client IP). Over the limit the event is not
  -- stored, but the live menu state is still returned.
  p_rate_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_item uuid;
  v_store boolean := true;
begin
  select b.* into v_branch
    from public.branches b
    join public.restaurants r on r.id = b.restaurant_id
   where b.slug = lower(btrim(p_slug)) and b.deleted_at is null and r.deleted_at is null;
  if not found then
    return null;
  end if;

  if p_item is not null then
    select i.id into v_item from public.items i where i.id = p_item and i.menu_id = v_branch.menu_id;
  end if;

  if p_rate_key is not null then
    v_store := public.rate_limit_hit('ev:' || p_rate_key, 300, 600);
  end if;

  if v_store and p_type in ('menu_view', 'item_view', 'whatsapp_order', 'order_copy', 'waiter_call', 'bill_request', 'momo_view') then
    insert into public.events (restaurant_id, branch_id, type, table_code, item_id, session_id)
    values (
      v_branch.restaurant_id, v_branch.id, p_type,
      case when p_table ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p_table) <= 24 then p_table end,
      v_item,
      case when p_session ~ '^[A-Za-z0-9_-]{8,40}$' then p_session end
    );
  end if;

  return private.menu_live(v_branch.id);
end;
$$;

revoke execute on function public.get_public_menu(text) from public;
revoke execute on function public.record_event(text, text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function private.menu_live(uuid) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated, service_role;
grant execute on function public.record_event(text, text, text, uuid, text, text) to service_role;
grant execute on function private.menu_live(uuid) to service_role;
