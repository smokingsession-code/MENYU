import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { SpecialsManager, type SpecialRow } from "@/components/dashboard/specials-manager";
import { planHas } from "@/config/plans";
import { featureBlock, getDashboardContext } from "@/lib/dashboard";
import { DAY_KEYS } from "@/lib/hours";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { NotAvailable } from "@/components/dashboard/not-available";

const t = getTranslator("en");

export default async function SpecialsPage({ params }: PageProps<"/dashboard/[restaurantId]/specials">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;

  if (featureBlock(ctx, "specials") === "switch") return <NotAvailable title={t("specials.title")} backHref={base} />;
  if (!planHas(ctx.plan, "specials")) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("specials.title")}</h1>
        <p>{t("specials.proOnly")}</p>
        <ButtonLink href={`${base}/billing`} className="w-full">
          {t("home2.proUpsellCta")}
        </ButtonLink>
      </Card>
    );
  }

  const supabase = await createClient();
  const [{ data: specials }, { data: categories }] = await Promise.all([
    supabase
      .from("specials")
      .select("id, title, title_lg, description, description_lg, price_ugx, days, start_time, end_time, starts_on, ends_on, is_active, special_items(item_id)")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("categories")
      .select("name, sort_order, items(id, name, sort_order, deleted_at)")
      .eq("menu_id", ctx.branch.menuId)
      .is("deleted_at", null)
      .order("sort_order"),
  ]);

  const rows: SpecialRow[] = (specials ?? []).map((sp) => ({
    id: sp.id,
    title: sp.title,
    title_lg: sp.title_lg,
    description: sp.description,
    description_lg: sp.description_lg,
    price_ugx: sp.price_ugx,
    days: sp.days,
    start_time: sp.start_time,
    end_time: sp.end_time,
    starts_on: sp.starts_on,
    ends_on: sp.ends_on,
    is_active: sp.is_active,
    item_ids: sp.special_items.map((si) => si.item_id),
  }));
  const dishes = (categories ?? []).flatMap((c) =>
    c.items
      .filter((i) => !i.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: i.id, name: i.name, category: c.name })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("specials.title")}</h1>
        <p className="text-muted">{t("specials.intro")}</p>
      </div>
      <SpecialsManager
        restaurantId={restaurantId}
        specials={rows}
        dishes={dishes}
        dayNames={DAY_KEYS.map((k) => t(`diner.days.${k}`))}
        s={{ ...sectionStrings("en", "specials"), close: t("common.close") }}
      />
    </div>
  );
}
