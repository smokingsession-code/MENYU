-- Menu editor operations. All run as the calling user (security invoker),
-- so row-level security and column grants apply exactly as for direct
-- writes; the functions only add atomicity and save round trips on 3G.

-- ---------------------------------------------------------------------------
-- save_item: create or update an item together with its sizes and add-ons.
--   p_item = { id?, restaurant_id, category_id, name, name_lg?, description?,
--              description_lg?, price_ugx?, tags[], is_hidden?,
--              options: [{ id?, kind, name, name_lg?, price_ugx }] }
-- Options not in the list are soft-deleted. Returns the item id.
-- ---------------------------------------------------------------------------
create or replace function public.save_item(p_item jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_item ->> 'id', '')::uuid;
  v_restaurant uuid := (p_item ->> 'restaurant_id')::uuid;
  v_category uuid := (p_item ->> 'category_id')::uuid;
  v_menu uuid;
  v_sort integer;
  v_tags text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_item -> 'tags', '[]'::jsonb))), '{}');
  v_price integer := nullif(p_item ->> 'price_ugx', '')::integer;
  v_keep uuid[] := '{}';
  v_option_id uuid;
  o record;
begin
  select c.menu_id into v_menu
    from public.categories c
   where c.id = v_category and c.restaurant_id = v_restaurant and c.deleted_at is null;
  if v_menu is null then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if v_id is null then
    select coalesce(max(i.sort_order) + 1, 0) into v_sort
      from public.items i where i.category_id = v_category and i.deleted_at is null;
    insert into public.items (restaurant_id, menu_id, category_id, name, name_lg, description, description_lg, price_ugx, tags, is_hidden, sort_order)
    values (
      v_restaurant, v_menu, v_category,
      btrim(p_item ->> 'name'),
      nullif(btrim(coalesce(p_item ->> 'name_lg', '')), ''),
      nullif(btrim(coalesce(p_item ->> 'description', '')), ''),
      nullif(btrim(coalesce(p_item ->> 'description_lg', '')), ''),
      v_price, v_tags,
      coalesce((p_item ->> 'is_hidden')::boolean, false),
      v_sort
    )
    returning id into v_id;
  else
    update public.items
       set category_id = v_category,
           name = btrim(p_item ->> 'name'),
           name_lg = nullif(btrim(coalesce(p_item ->> 'name_lg', '')), ''),
           description = nullif(btrim(coalesce(p_item ->> 'description', '')), ''),
           description_lg = nullif(btrim(coalesce(p_item ->> 'description_lg', '')), ''),
           price_ugx = v_price,
           tags = v_tags,
           is_hidden = coalesce((p_item ->> 'is_hidden')::boolean, false)
     where id = v_id and restaurant_id = v_restaurant and deleted_at is null;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  for o in
    select value as opt, ordinality - 1 as position
      from jsonb_array_elements(coalesce(p_item -> 'options', '[]'::jsonb)) with ordinality
  loop
    v_option_id := nullif(o.opt ->> 'id', '')::uuid;
    if v_option_id is not null then
      update public.item_options
         set kind = o.opt ->> 'kind',
             name = btrim(o.opt ->> 'name'),
             name_lg = nullif(btrim(coalesce(o.opt ->> 'name_lg', '')), ''),
             price_ugx = (o.opt ->> 'price_ugx')::integer,
             sort_order = o.position
       where id = v_option_id and item_id = v_id and deleted_at is null;
      if not found then
        v_option_id := null;
      end if;
    end if;
    if v_option_id is null then
      insert into public.item_options (restaurant_id, item_id, kind, name, name_lg, price_ugx, sort_order)
      values (
        v_restaurant, v_id, o.opt ->> 'kind', btrim(o.opt ->> 'name'),
        nullif(btrim(coalesce(o.opt ->> 'name_lg', '')), ''),
        (o.opt ->> 'price_ugx')::integer, o.position
      )
      returning id into v_option_id;
    end if;
    v_keep := v_keep || v_option_id;
  end loop;

  update public.item_options
     set deleted_at = now()
   where item_id = v_id and deleted_at is null and not (id = any (v_keep));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- reorder: sets sort_order from the position in p_ids.
-- ---------------------------------------------------------------------------
create or replace function public.reorder(p_kind text, p_ids uuid[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind = 'categories' then
    update public.categories c set sort_order = x.ord - 1
      from unnest(p_ids) with ordinality as x(id, ord)
     where c.id = x.id and c.sort_order is distinct from (x.ord - 1)::integer;
  elsif p_kind = 'items' then
    update public.items i set sort_order = x.ord - 1
      from unnest(p_ids) with ordinality as x(id, ord)
     where i.id = x.id and i.sort_order is distinct from (x.ord - 1)::integer;
  elsif p_kind = 'tables' then
    update public.tables t set sort_order = x.ord - 1
      from unnest(p_ids) with ordinality as x(id, ord)
     where t.id = x.id and t.sort_order is distinct from (x.ord - 1)::integer;
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- bulk_adjust_prices: e.g. +10% on all drinks, rounded to the nearest 500.
-- Changes item prices, sizes and add-ons. Returns how many prices changed.
-- ---------------------------------------------------------------------------
create or replace function public.bulk_adjust_prices(
  p_restaurant_id uuid,
  p_category_ids uuid[],
  p_percent numeric,
  p_round integer default 500
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_items integer;
  v_options integer;
  v_round integer := greatest(1, coalesce(p_round, 1));
begin
  if p_percent is null or p_percent < -90 or p_percent > 300 then
    raise exception 'invalid_percent' using errcode = '22023';
  end if;

  update public.items i
     set price_ugx = greatest(0, round(i.price_ugx * (1 + p_percent / 100.0) / v_round) * v_round)::integer
   where i.restaurant_id = p_restaurant_id
     and i.deleted_at is null
     and i.price_ugx is not null
     and (p_category_ids is null or i.category_id = any (p_category_ids));
  get diagnostics v_items = row_count;

  update public.item_options o
     set price_ugx = greatest(0, round(o.price_ugx * (1 + p_percent / 100.0) / v_round) * v_round)::integer
    from public.items i
   where o.item_id = i.id
     and o.deleted_at is null
     and i.restaurant_id = p_restaurant_id
     and i.deleted_at is null
     and (p_category_ids is null or i.category_id = any (p_category_ids));
  get diagnostics v_options = row_count;

  return v_items + v_options;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_tables: adds tables by number or name ("5", "Garden 1"). A table that
-- was deleted and is added again gets its old code back, so stickers that
-- are still printed keep working. Returns the number added.
-- ---------------------------------------------------------------------------
create or replace function public.add_tables(p_branch_id uuid, p_labels text[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_restaurant uuid;
  v_label text;
  v_base text;
  v_code text;
  v_sort integer;
  v_added integer := 0;
  i integer;
begin
  select b.restaurant_id into v_restaurant from public.branches b where b.id = p_branch_id and b.deleted_at is null;
  if v_restaurant is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(max(t.sort_order) + 1, 0) into v_sort from public.tables t where t.branch_id = p_branch_id and t.deleted_at is null;

  foreach v_label in array p_labels loop
    v_label := left(btrim(v_label), 40);
    continue when v_label = '';
    -- Already there (same name): skip.
    continue when exists (
      select 1 from public.tables t where t.branch_id = p_branch_id and t.deleted_at is null and lower(t.label) = lower(v_label)
    );
    v_base := left(private.slugify(v_label), 20);
    if v_base = '' then
      v_base := 't';
    end if;
    v_code := v_base;
    i := 1;
    while exists (select 1 from public.tables t where t.branch_id = p_branch_id and t.deleted_at is null and t.code = v_code) loop
      i := i + 1;
      v_code := v_base || '-' || i;
    end loop;
    insert into public.tables (restaurant_id, branch_id, label, code, sort_order)
    values (v_restaurant, p_branch_id, v_label, v_code, v_sort);
    v_sort := v_sort + 1;
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;

revoke execute on function public.save_item(jsonb) from public, anon;
revoke execute on function public.reorder(text, uuid[]) from public, anon;
revoke execute on function public.bulk_adjust_prices(uuid, uuid[], numeric, integer) from public, anon;
revoke execute on function public.add_tables(uuid, text[]) from public, anon;
grant execute on function public.save_item(jsonb) to authenticated;
grant execute on function public.reorder(text, uuid[]) to authenticated;
grant execute on function public.bulk_adjust_prices(uuid, uuid[], numeric, integer) to authenticated;
grant execute on function public.add_tables(uuid, text[]) to authenticated;
