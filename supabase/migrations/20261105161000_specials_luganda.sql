-- Specials keep their Luganda title and description when saved.

-- ---------------------------------------------------------------------------
-- save_special: creates or updates a special and its dishes in one go. Runs
-- as the caller, so row-level security checks the owner and the plan.
-- p: id (optional), restaurant_id, title, description, price_ugx, days,
-- start_time, end_time, starts_on, ends_on, is_active, item_ids, and the
-- Luganda title_lg and description_lg.
-- ---------------------------------------------------------------------------
create or replace function public.save_special(p jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_restaurant uuid := (p ->> 'restaurant_id')::uuid;
  v_days smallint[] := array(select distinct jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb))::smallint order by 1);
  v_items uuid[] := array(select distinct jsonb_array_elements_text(coalesce(p -> 'item_ids', '[]'::jsonb))::uuid);
begin
  if v_id is null then
    insert into public.specials (
      restaurant_id, title, title_lg, description, description_lg, price_ugx, days, start_time, end_time, starts_on, ends_on, is_active, sort_order
    )
    values (
      v_restaurant, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'title_lg', '')), ''),
      nullif(btrim(coalesce(p ->> 'description', '')), ''), nullif(btrim(coalesce(p ->> 'description_lg', '')), ''),
      (p ->> 'price_ugx')::integer, v_days, (p ->> 'start_time')::time, (p ->> 'end_time')::time,
      (p ->> 'starts_on')::date, (p ->> 'ends_on')::date, coalesce((p ->> 'is_active')::boolean, true),
      coalesce((select max(s.sort_order) + 1 from public.specials s where s.restaurant_id = v_restaurant and s.deleted_at is null), 0)
    )
    returning id into v_id;
  else
    update public.specials
       set title = btrim(p ->> 'title'),
           title_lg = nullif(btrim(coalesce(p ->> 'title_lg', '')), ''),
           description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
           description_lg = nullif(btrim(coalesce(p ->> 'description_lg', '')), ''),
           price_ugx = (p ->> 'price_ugx')::integer,
           days = v_days,
           start_time = (p ->> 'start_time')::time,
           end_time = (p ->> 'end_time')::time,
           starts_on = (p ->> 'starts_on')::date,
           ends_on = (p ->> 'ends_on')::date,
           is_active = coalesce((p ->> 'is_active')::boolean, true)
     where id = v_id and restaurant_id = v_restaurant and deleted_at is null;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.special_items si where si.special_id = v_id and not (si.item_id = any (v_items));
  insert into public.special_items (special_id, item_id, restaurant_id, quantity)
  select v_id, x, v_restaurant, 1
    from unnest(v_items) x
   where exists (select 1 from public.items i where i.id = x and i.restaurant_id = v_restaurant and i.deleted_at is null)
  on conflict (special_id, item_id) do nothing;
  return v_id;
end;
$$;

revoke execute on function public.save_special(jsonb) from public, anon;
grant execute on function public.save_special(jsonb) to authenticated;
