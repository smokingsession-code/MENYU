import Link from "next/link";
import { Badge, Card } from "@/components/ui/card";
import { DirectorySwitch, ListingButtons } from "@/components/admin/directory-controls";
import { planHas } from "@/config/plans";
import { requireAdmin } from "@/lib/auth";
import { effectivePlan } from "@/lib/billing/plan";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";

const t = getTranslator("en");

export default async function AdminDirectoryPage() {
  await requireAdmin();
  const db = createAdminClient();
  const [{ data: setting }, { data: restaurants }] = await Promise.all([
    // Read the switch fresh: public pages use a cached copy. It is the same
    // "Menus near me" switch as on Admin > Features.
    db.from("feature_flags").select("enabled").eq("key", "directory").maybeSingle(),
    db
      .from("restaurants")
      .select("id, name, directory_status, is_featured, subscriptions(plan, status), branches(area, is_main, deleted_at)")
      .in("directory_status", ["pending", "approved"])
      .is("deleted_at", null)
      .eq("is_demo", false)
      .order("name"),
  ]);
  const settings = { directoryEnabled: setting?.enabled === true };
  const s = Object.fromEntries(Object.entries(sectionStrings("en", "admin")).filter(([k]) => k.startsWith("directory.")).map(([k, v]) => [k.slice(10), v]));
  const rows = (restaurants ?? []).map((r) => {
    const plan = effectivePlan(r.subscriptions);
    return { ...r, plan, area: r.branches.find((b) => b.is_main && !b.deleted_at)?.area ?? null };
  });
  const pending = rows.filter((r) => r.directory_status === "pending");
  const approved = rows.filter((r) => r.directory_status === "approved");
  const live = approved.filter((r) => planHas(r.plan, "directory_listing")).length;

  const list = (title: string, items: typeof rows) => (
    <Card className="space-y-2">
      <h2 className="text-lg font-extrabold">
        {title} <Badge tone={items.length ? "yellow" : "grey"}>{items.length}</Badge>
      </h2>
      {items.length === 0 ? <p className="text-muted">{t("admin.directory.none")}</p> : null}
      <ul className="divide-y divide-line">
        {items.map((r) => (
          <li key={r.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/admin/restaurants/${r.id}`} className="font-bold text-brand underline">
                {r.name}
              </Link>
              <span className="flex items-center gap-2 text-sm text-muted">
                {r.is_featured ? <Badge tone="yellow">{t("admin.directory.featuredBadge")}</Badge> : null}
                {[r.area, r.plan].filter(Boolean).join(" · ")}
              </span>
            </div>
            <ListingButtons restaurantId={r.id} status={r.directory_status} featured={r.is_featured} canFeature={planHas(r.plan, "featured_listing")} s={s} />
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{t("admin.directory.title")}</h1>
        <p className="text-muted">{t("admin.directory.intro")}</p>
      </div>
      <Card className="space-y-3">
        <p className="font-bold">{settings.directoryEnabled ? t("admin.directory.isOn") : t("admin.directory.isOff")}</p>
        <p className="text-muted">{t("admin.directory.listedCount", { count: live })}</p>
        <div className="flex flex-wrap gap-2">
          <DirectorySwitch enabled={settings.directoryEnabled} label={settings.directoryEnabled ? t("admin.directory.switchOff") : t("admin.directory.switchOn")} />
          <Link href="/menus" className="inline-flex min-h-11 items-center px-2 font-bold text-brand underline">
            {t("admin.directory.preview")}
          </Link>
        </div>
      </Card>
      {list(t("admin.directory.pending"), pending)}
      {list(t("admin.directory.approved"), approved)}
    </div>
  );
}
