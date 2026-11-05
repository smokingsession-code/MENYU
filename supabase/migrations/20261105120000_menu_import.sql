-- Publishing a reviewed menu import. Nothing from an import is visible to
-- diners until this runs.

create index if not exists menu_imports_status on public.menu_imports (restaurant_id, status) where deleted_at is null;

-- p_mode: 'append' adds the sections after the existing menu; 'replace'
-- soft-deletes the current sections and dishes first (they can be restored).
create or replace function public.publish_menu_import(p_import_id uuid, p_draft jsonb, p_mode text default 'append')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_import public.menu_imports%rowtype;
  v_section jsonb;
  v_item jsonb;
  v_option jsonb;
  v_category_id uuid;
  v_item_id uuid;
  v_category_sort integer;
  v_item_sort integer;
  v_option_sort integer;
  v_has_sizes boolean;
  v_sections integer := 0;
  v_items integer := 0;
begin
  select * into v_import from public.menu_imports i where i.id = p_import_id and i.deleted_at is null for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Runs with elevated rights, so check the caller explicitly.
  if not private.can_edit_menu(v_import.restaurant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_import.status <> 'needs_review' then
    raise exception 'not_reviewable' using errcode = '22023';
  end if;
  if p_mode not in ('append', 'replace') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_draft -> 'sections') is distinct from 'array' then
    raise exception 'invalid_draft' using errcode = '22023';
  end if;

  if p_mode = 'replace' then
    update public.items set deleted_at = now() where menu_id = v_import.menu_id and deleted_at is null;
    update public.categories set deleted_at = now() where menu_id = v_import.menu_id and deleted_at is null;
  end if;

  select coalesce(max(c.sort_order) + 1, 0) into v_category_sort
    from public.categories c where c.menu_id = v_import.menu_id and c.deleted_at is null;

  for v_section in select value from jsonb_array_elements(p_draft -> 'sections') loop
    continue when jsonb_typeof(v_section -> 'items') is distinct from 'array' or jsonb_array_length(v_section -> 'items') = 0;
    insert into public.categories (restaurant_id, menu_id, name, sort_order)
    values (
      v_import.restaurant_id, v_import.menu_id,
      coalesce(nullif(left(btrim(coalesce(v_section ->> 'name', '')), 80), ''), 'Menu'),
      v_category_sort
    )
    returning id into v_category_id;
    v_category_sort := v_category_sort + 1;
    v_sections := v_sections + 1;
    v_item_sort := 0;

    for v_item in select value from jsonb_array_elements(v_section -> 'items') loop
      continue when nullif(btrim(coalesce(v_item ->> 'name', '')), '') is null;
      v_has_sizes := jsonb_typeof(v_item -> 'sizes') = 'array' and jsonb_array_length(v_item -> 'sizes') > 0;
      insert into public.items (restaurant_id, menu_id, category_id, name, description, price_ugx, tags, sort_order)
      values (
        v_import.restaurant_id, v_import.menu_id, v_category_id,
        left(btrim(v_item ->> 'name'), 120),
        nullif(left(btrim(coalesce(v_item ->> 'description', '')), 300), ''),
        case when v_has_sizes then null else (v_item ->> 'price')::integer end,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item -> 'tags', '[]'::jsonb))), '{}'),
        v_item_sort
      )
      returning id into v_item_id;
      v_item_sort := v_item_sort + 1;
      v_items := v_items + 1;

      v_option_sort := 0;
      for v_option in select value from jsonb_array_elements(coalesce(v_item -> 'sizes', '[]'::jsonb)) loop
        insert into public.item_options (restaurant_id, item_id, kind, name, price_ugx, sort_order)
        values (v_import.restaurant_id, v_item_id, 'size', left(btrim(v_option ->> 'name'), 60), (v_option ->> 'price')::integer, v_option_sort);
        v_option_sort := v_option_sort + 1;
      end loop;
      v_option_sort := 0;
      for v_option in select value from jsonb_array_elements(coalesce(v_item -> 'addons', '[]'::jsonb)) loop
        insert into public.item_options (restaurant_id, item_id, kind, name, price_ugx, sort_order)
        values (v_import.restaurant_id, v_item_id, 'addon', left(btrim(v_option ->> 'name'), 60), (v_option ->> 'price')::integer, v_option_sort);
        v_option_sort := v_option_sort + 1;
      end loop;
    end loop;
  end loop;

  if v_items = 0 then
    raise exception 'empty_draft' using errcode = '22023';
  end if;

  update public.menu_imports
     set status = 'published', draft = p_draft, published_at = now(), published_by = (select auth.uid())
   where id = p_import_id;

  perform private.audit('menu_import.published', v_import.restaurant_id, jsonb_build_object(
    'import_id', p_import_id, 'mode', p_mode, 'sections', v_sections, 'items', v_items
  ));
  return jsonb_build_object('sections', v_sections, 'items', v_items);
end;
$$;

revoke execute on function public.publish_menu_import(uuid, jsonb, text) from public, anon;
grant execute on function public.publish_menu_import(uuid, jsonb, text) to authenticated;
