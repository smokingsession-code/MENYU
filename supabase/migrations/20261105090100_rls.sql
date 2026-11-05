-- Row-level security for every table.
--
-- Model:
--   * anon (diners) has no table access at all. Public menu data is served
--     only through security-definer functions that return exactly the public
--     fields. Diner writes (events, feedback) go through rate-limited server
--     routes using the service role.
--   * authenticated users see rows of restaurants they are members of.
--     Owners write; staff may only toggle sold-out (and read feedback).
--     Plan features are enforced here too, using the plans table that is
--     generated from src/config/plans.ts.
--   * Admins (rows in public.admins) can read and edit every restaurant.
--   * Privileged columns (billing, agent, slug, featured...) are not granted
--     to authenticated at all; they change only through server code using
--     the service role after an explicit admin check.

-- ---------------------------------------------------------------------------
-- Helper functions (private schema: not exposed through the API)
-- ---------------------------------------------------------------------------

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function private.member_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.restaurant_id
    from public.memberships m
   where m.user_id = (select auth.uid()) and m.deleted_at is null;
$$;

create or replace function private.owner_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.restaurant_id
    from public.memberships m
   where m.user_id = (select auth.uid()) and m.role = 'owner' and m.deleted_at is null;
$$;

-- Users who share a restaurant the caller owns (for the staff list).
create or replace function private.colleague_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
    from public.memberships m
   where m.deleted_at is null
     and m.restaurant_id in (
       select o.restaurant_id from public.memberships o
        where o.user_id = (select auth.uid()) and o.role = 'owner' and o.deleted_at is null
     );
$$;

create or replace function private.effective_plan(p_restaurant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when s.status = 'free' then 'free' else s.plan end
       from public.subscriptions s
      where s.restaurant_id = p_restaurant_id),
    'free'
  );
$$;

create or replace function private.plan_allows(p_restaurant_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (p.features ->> p_feature)::boolean
       from public.plans p
      where p.code = private.effective_plan(p_restaurant_id)),
    false
  );
$$;

-- Owners edit their menu when the plan includes self-service editing
-- (Free menus are changed on request by the Menyu team).
create or replace function private.can_edit_menu(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or (p_restaurant_id in (select private.owner_restaurant_ids())
          and private.plan_allows(p_restaurant_id, 'menu_editing'));
$$;

-- Owners manage profile, branches and tables when the plan has the dashboard.
create or replace function private.can_manage(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or (p_restaurant_id in (select private.owner_restaurant_ids())
          and private.plan_allows(p_restaurant_id, 'dashboard'));
$$;

create or replace function private.can_toggle_sold_out(p_restaurant_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or exists (
        select 1
          from public.memberships m
         where m.user_id = (select auth.uid())
           and m.restaurant_id = p_restaurant_id
           and m.deleted_at is null
           and (
             (m.role = 'owner' and private.plan_allows(p_restaurant_id, 'menu_editing'))
             or (m.role = 'staff'
                 and private.plan_allows(p_restaurant_id, 'staff')
                 and (m.branch_id is null or m.branch_id = p_branch_id))
           )
      );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant exactly what is needed.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

grant select on all tables in schema public to authenticated;
grant select on public.plans to anon;

-- Column-level write grants. Anything not listed cannot be written by an
-- authenticated user, whatever the row policies say.
grant update (full_name, locale) on public.profiles to authenticated;

grant update (name, description, description_lg, logo, cover, brand_color, cuisines, price_range)
  on public.restaurants to authenticated;

grant insert (restaurant_id, name) on public.menus to authenticated;
grant update (name, deleted_at) on public.menus to authenticated;

grant update (
  name, area, address, lat, lng, phone, whatsapp,
  momo_mtn_code, momo_mtn_name, momo_airtel_code, momo_airtel_name,
  opening_hours, accepts_dine_in, accepts_takeaway, accepts_delivery,
  delivery_note, sort_order
) on public.branches to authenticated;

grant update (branch_id, deleted_at) on public.memberships to authenticated;
grant update (deleted_at) on public.invitations to authenticated;

grant insert (id, restaurant_id, menu_id, name, name_lg, sort_order, is_hidden)
  on public.categories to authenticated;
grant update (name, name_lg, sort_order, is_hidden, deleted_at)
  on public.categories to authenticated;

grant insert (
  id, restaurant_id, menu_id, category_id, name, name_lg, description, description_lg,
  price_ugx, photo, tags, is_hidden, sort_order
) on public.items to authenticated;
grant update (
  category_id, name, name_lg, description, description_lg, price_ugx, photo, tags,
  is_hidden, sort_order, deleted_at
) on public.items to authenticated;

grant insert (id, restaurant_id, item_id, kind, name, name_lg, price_ugx, sort_order)
  on public.item_options to authenticated;
grant update (kind, name, name_lg, price_ugx, sort_order, deleted_at)
  on public.item_options to authenticated;

grant insert (branch_id, item_id, restaurant_id, created_by) on public.sold_out to authenticated;
grant delete on public.sold_out to authenticated;

grant insert (restaurant_id, branch_id, label, code, sort_order) on public.tables to authenticated;
grant update (label, sort_order, deleted_at) on public.tables to authenticated;

grant insert (
  id, restaurant_id, branch_id, title, title_lg, description, description_lg, price_ugx,
  days, start_time, end_time, starts_on, ends_on, is_active, sort_order
) on public.specials to authenticated;
grant update (
  branch_id, title, title_lg, description, description_lg, price_ugx, days, start_time,
  end_time, starts_on, ends_on, is_active, sort_order, deleted_at
) on public.specials to authenticated;

grant insert (special_id, item_id, restaurant_id, quantity) on public.special_items to authenticated;
grant update (quantity) on public.special_items to authenticated;
grant delete on public.special_items to authenticated;

grant update (draft, deleted_at) on public.menu_imports to authenticated;

grant update (read_at, deleted_at) on public.feedback to authenticated;

grant insert (restaurant_id, kind, contact_name, contact_phone, notes, files)
  on public.setup_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select private.colleague_user_ids())
    or (select private.is_admin())
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- admins: a user can see whether they are an admin, nothing more.
create policy admins_select_self on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

-- settings, agents, commissions, payouts, audit log: admin read only.
create policy settings_admin_select on public.settings for select to authenticated
  using ((select private.is_admin()));
create policy agents_admin_select on public.agents for select to authenticated
  using ((select private.is_admin()));
create policy agent_commissions_admin_select on public.agent_commissions for select to authenticated
  using ((select private.is_admin()));
create policy agent_payouts_admin_select on public.agent_payouts for select to authenticated
  using ((select private.is_admin()));
create policy audit_log_admin_select on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- plans: public price list.
create policy plans_public_select on public.plans for select to anon, authenticated
  using (true);

-- restaurants
create policy restaurants_select on public.restaurants for select to authenticated
  using (id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy restaurants_update on public.restaurants for update to authenticated
  using (private.can_manage(id))
  with check (private.can_manage(id));

-- menus
create policy menus_select on public.menus for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy menus_insert on public.menus for insert to authenticated
  with check (private.can_edit_menu(restaurant_id) and private.plan_allows(restaurant_id, 'branches'));
create policy menus_update on public.menus for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id));

-- branches
create policy branches_select on public.branches for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy branches_update on public.branches for update to authenticated
  using (private.can_manage(restaurant_id))
  with check (private.can_manage(restaurant_id));

-- memberships: see your own, owners see their team; owners can limit or
-- remove staff (never other owners).
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or restaurant_id in (select private.owner_restaurant_ids())
    or (select private.is_admin())
  );
create policy memberships_update_staff on public.memberships for update to authenticated
  using (
    role = 'staff'
    and (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()))
  )
  with check (
    role = 'staff'
    and (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()))
  );

-- invitations: created through create_invitation(); owners can see and
-- revoke their restaurant's invitations.
create policy invitations_select on public.invitations for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));
create policy invitations_revoke on public.invitations for update to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()))
  with check (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));

-- menu content: categories, items, options
create policy categories_select on public.categories for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy categories_insert on public.categories for insert to authenticated
  with check (private.can_edit_menu(restaurant_id));
create policy categories_update on public.categories for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id));

create policy items_select on public.items for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy items_insert on public.items for insert to authenticated
  with check (private.can_edit_menu(restaurant_id));
create policy items_update on public.items for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id));

create policy item_options_select on public.item_options for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy item_options_insert on public.item_options for insert to authenticated
  with check (private.can_edit_menu(restaurant_id));
create policy item_options_update on public.item_options for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id));

-- sold out: owners, admin, and staff (per their branch) on plans with staff.
create policy sold_out_select on public.sold_out for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy sold_out_insert on public.sold_out for insert to authenticated
  with check (private.can_toggle_sold_out(restaurant_id, branch_id));
create policy sold_out_delete on public.sold_out for delete to authenticated
  using (private.can_toggle_sold_out(restaurant_id, branch_id));

-- tables (QR codes per table need a plan with table QR codes)
create policy tables_select on public.tables for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy tables_insert on public.tables for insert to authenticated
  with check (private.can_manage(restaurant_id) and private.plan_allows(restaurant_id, 'table_qr'));
create policy tables_update on public.tables for update to authenticated
  using (private.can_manage(restaurant_id))
  with check (private.can_manage(restaurant_id));

-- specials (Pro)
create policy specials_select on public.specials for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy specials_insert on public.specials for insert to authenticated
  with check (private.can_edit_menu(restaurant_id) and private.plan_allows(restaurant_id, 'specials'));
create policy specials_update on public.specials for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id) and private.plan_allows(restaurant_id, 'specials'));

create policy special_items_select on public.special_items for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy special_items_insert on public.special_items for insert to authenticated
  with check (private.can_edit_menu(restaurant_id) and private.plan_allows(restaurant_id, 'specials'));
create policy special_items_update on public.special_items for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id) and private.plan_allows(restaurant_id, 'specials'));
create policy special_items_delete on public.special_items for delete to authenticated
  using (private.can_edit_menu(restaurant_id));

-- menu imports: owners who can edit the menu, and admin.
create policy menu_imports_select on public.menu_imports for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));
create policy menu_imports_update on public.menu_imports for update to authenticated
  using (private.can_edit_menu(restaurant_id))
  with check (private.can_edit_menu(restaurant_id));

-- feedback: owners and staff read it; only the service role inserts.
create policy feedback_select on public.feedback for select to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));
create policy feedback_update on public.feedback for update to authenticated
  using (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()))
  with check (restaurant_id in (select private.member_restaurant_ids()) or (select private.is_admin()));

-- events: owners and admin read; only the service role inserts.
create policy events_select on public.events for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));

-- setup and change requests: any owner may ask, whatever the plan.
create policy setup_requests_select on public.setup_requests for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));
create policy setup_requests_insert on public.setup_requests for insert to authenticated
  with check (restaurant_id in (select private.owner_restaurant_ids()));

-- billing: owners (not staff) can see their own; writes are service role only.
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));
create policy payments_select on public.payments for select to authenticated
  using (restaurant_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));
create policy referrals_select on public.referrals for select to authenticated
  using (referrer_id in (select private.owner_restaurant_ids()) or (select private.is_admin()));

-- rate_limits: no policies; service role only.
