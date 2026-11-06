-- Branches (Pro), directory listings and the "Menus near me" search.

-- ---------------------------------------------------------------------------
-- add_branch: a new location. Its menu is the main branch's (shared), a copy
-- of it to change separately, or empty. Owners on a plan with branches, and
-- admins for those restaurants.
-- ---------------------------------------------------------------------------
create or replace function public.add_branch(
  p_restaurant_id uuid,
  p_name text,
  p_area text default null,
  p_whatsapp text default null,
  p_menu text default 'shared'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_main public.branches%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  v_area text := nullif(left(btrim(coalesce(p_area, '')), 80), '');
  v_menu uuid;
  v_branch uuid;
  v_slug text;
  v_category record;
  v_new_category uuid;
  v_item record;
  v_new_item uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.can_manage(p_restaurant_id) or not private.plan_allows(p_restaurant_id, 'branches') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_whatsapp is not null and p_whatsapp !~ '^[0-9]{9,15}$' then
    raise exception 'invalid_whatsapp' using errcode = '22023';
  end if;
  if p_menu not in ('shared', 'copy', 'empty') then
    raise exception 'invalid_menu' using errcode = '22023';
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id and deleted_at is null;
  select * into v_main from public.branches b
   where b.restaurant_id = p_restaurant_id and b.deleted_at is null
   order by b.is_main desc, b.sort_order limit 1;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_menu = 'shared' then
    v_menu := v_main.menu_id;
  else
    insert into public.menus (restaurant_id, name) values (p_restaurant_id, left(v_name, 80)) returning id into v_menu;
  end if;

  if p_menu = 'copy' then
    for v_category in
      select * from public.categories c where c.menu_id = v_main.menu_id and c.deleted_at is null order by c.sort_order
    loop
      insert into public.categories (restaurant_id, menu_id, name, name_lg, sort_order, is_hidden)
      values (p_restaurant_id, v_menu, v_category.name, v_category.name_lg, v_category.sort_order, v_category.is_hidden)
      returning id into v_new_category;
      for v_item in
        select * from public.items i where i.category_id = v_category.id and i.deleted_at is null order by i.sort_order
      loop
        insert into public.items (restaurant_id, menu_id, category_id, name, name_lg, description, description_lg, price_ugx, photo, tags, is_hidden, sort_order)
        values (p_restaurant_id, v_menu, v_new_category, v_item.name, v_item.name_lg, v_item.description, v_item.description_lg,
                v_item.price_ugx, v_item.photo, v_item.tags, v_item.is_hidden, v_item.sort_order)
        returning id into v_new_item;
        insert into public.item_options (restaurant_id, item_id, kind, name, name_lg, price_ugx, sort_order)
        select p_restaurant_id, v_new_item, o.kind, o.name, o.name_lg, o.price_ugx, o.sort_order
          from public.item_options o where o.item_id = v_item.id and o.deleted_at is null;
      end loop;
    end loop;
  end if;

  v_slug := private.unique_branch_slug(v_restaurant.name || ' ' || coalesce(v_area, v_name));
  insert into public.branches (
    restaurant_id, menu_id, name, slug, area, phone, whatsapp,
    momo_mtn_code, momo_mtn_name, momo_airtel_code, momo_airtel_name, opening_hours,
    accepts_dine_in, accepts_takeaway, accepts_delivery, delivery_note, is_main, sort_order
  )
  values (
    p_restaurant_id, v_menu, v_name, v_slug, v_area,
    coalesce(p_whatsapp, v_main.phone), coalesce(p_whatsapp, v_main.whatsapp),
    v_main.momo_mtn_code, v_main.momo_mtn_name, v_main.momo_airtel_code, v_main.momo_airtel_name, v_main.opening_hours,
    v_main.accepts_dine_in, v_main.accepts_takeaway, v_main.accepts_delivery, v_main.delivery_note, false,
    coalesce((select max(b.sort_order) + 1 from public.branches b where b.restaurant_id = p_restaurant_id), 1)
  )
  returning id into v_branch;

  perform private.audit('branch.added', p_restaurant_id, jsonb_build_object('branch_id', v_branch, 'menu', p_menu));
  return jsonb_build_object('branch_id', v_branch, 'slug', v_slug, 'menu_id', v_menu);
end;
$$;

-- ---------------------------------------------------------------------------
-- Directory listing requests: the owner asks, the Menyu team approves.
-- ---------------------------------------------------------------------------
create or replace function public.request_directory_listing(p_restaurant_id uuid, p_listed boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (private.is_admin() or p_restaurant_id in (select private.owner_restaurant_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_listed and not private.plan_allows(p_restaurant_id, 'directory_listing') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  update public.restaurants
     set directory_status = case
           when not p_listed then 'hidden'
           when directory_status = 'approved' then 'approved'
           else 'pending' end
   where id = p_restaurant_id and deleted_at is null
  returning directory_status into v_status;
  if v_status is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.audit('directory.requested', p_restaurant_id, jsonb_build_object('listed', p_listed, 'status', v_status));
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- directory_search: approved listings on plans with a directory listing,
-- one entry per branch, featured (Pro) first. Matches restaurant names and
-- dish names ("rolex", "pork"). While the directory is switched off only
-- admins get results.
-- ---------------------------------------------------------------------------
create or replace function public.directory_search(
  p_query text default null,
  p_area text default null,
  p_cuisine text default null,
  p_price smallint default null,
  p_limit integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := coalesce((select (s.value #>> '{}')::boolean from public.settings s where s.key = 'directory_enabled'), false);
  v_q text := nullif(left(btrim(coalesce(p_query, '')), 60), '');
  v_pattern text;
  v_results jsonb;
  v_areas jsonb;
begin
  if not v_enabled and not private.is_admin() then
    return jsonb_build_object('enabled', false, 'results', '[]'::jsonb, 'areas', '[]'::jsonb);
  end if;
  -- Treat the search as plain text, not a LIKE pattern.
  v_pattern := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with listed as (
    select r.id, r.name, r.cuisines, r.price_range, r.logo, b.slug, b.area, b.opening_hours, b.menu_id,
           (r.is_featured and private.plan_allows(r.id, 'featured_listing')) as featured
      from public.restaurants r
      join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
     where r.deleted_at is null and r.directory_status = 'approved' and not r.is_suspended and not r.is_demo
       and private.plan_allows(r.id, 'directory_listing')
  ),
  matched as (
    select l.*,
           case when v_q is null then '[]'::jsonb else coalesce((
             select jsonb_agg(d.name) from (
               select i.name from public.items i
                where i.menu_id = l.menu_id and i.deleted_at is null and not i.is_hidden and i.name ilike v_pattern
                order by i.sort_order limit 3
             ) d
           ), '[]'::jsonb) end as dishes
      from listed l
     where (p_area is null or lower(l.area) = lower(btrim(p_area)))
       and (p_cuisine is null or lower(btrim(p_cuisine)) = any (select lower(c) from unnest(l.cuisines) c))
       and (p_price is null or l.price_range = p_price)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', m.name, 'slug', m.slug, 'area', m.area, 'cuisines', to_jsonb(m.cuisines), 'price_range', m.price_range,
           'logo', m.logo, 'opening_hours', m.opening_hours, 'featured', m.featured, 'dishes', m.dishes
         ) order by m.featured desc, m.name), '[]'::jsonb)
    into v_results
    from (
      select * from matched m
       where v_q is null or m.name ilike v_pattern or jsonb_array_length(m.dishes) > 0
       order by m.featured desc, m.name
       limit least(greatest(coalesce(p_limit, 60), 1), 200)
    ) m;

  -- Areas with listings, for the area filter.
  select coalesce(jsonb_agg(jsonb_build_object('area', a.area, 'count', a.n) order by a.n desc, a.area), '[]'::jsonb)
    into v_areas
    from (
      select b.area, count(*) as n
        from public.restaurants r
        join public.branches b on b.restaurant_id = r.id and b.deleted_at is null
       where r.deleted_at is null and r.directory_status = 'approved' and not r.is_suspended and not r.is_demo
         and private.plan_allows(r.id, 'directory_listing') and b.area is not null
       group by b.area
    ) a;

  return jsonb_build_object('enabled', v_enabled, 'results', v_results, 'areas', v_areas);
end;
$$;

revoke execute on function public.add_branch(uuid, text, text, text, text) from public, anon;
revoke execute on function public.request_directory_listing(uuid, boolean) from public, anon;
revoke execute on function public.directory_search(text, text, text, smallint, integer) from public;
grant execute on function public.add_branch(uuid, text, text, text, text) to authenticated;
grant execute on function public.request_directory_listing(uuid, boolean) to authenticated;
grant execute on function public.directory_search(text, text, text, smallint, integer) to anon, authenticated;
