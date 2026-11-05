import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { getTranslator, type MessageKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanCode } from "@/config/plans";

const t = getTranslator("en");

const STATUS_TONE = { trial: "yellow", active: "green", overdue: "red", free: "grey" } as const;
type Status = keyof typeof STATUS_TONE;

export default async function AdminRestaurantsPage({ searchParams }: PageProps<"/admin/restaurants">) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 80) : "";

  const supabase = await createClient();
  let request = supabase
    .from("restaurants")
    .select(
      "id, name, menu_updated_at, created_at, agents(name, code), subscriptions(plan, status), branches(area, slug, is_main, deleted_at)",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (query) request = request.ilike("name", `%${query.replace(/[%_]/g, "")}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r) => {
    const main = r.branches.find((b) => b.is_main && !b.deleted_at) ?? r.branches[0];
    return {
      id: r.id,
      name: r.name,
      area: main?.area ?? "",
      slug: main?.slug ?? "",
      agent: r.agents?.name ?? null,
      plan: (r.subscriptions?.plan ?? "free") as PlanCode,
      status: (r.subscriptions?.status ?? "free") as Status,
      lastUpdate: r.menu_updated_at,
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{t("admin.restaurants.title")}</h1>
          <p className="text-muted">{t("admin.restaurants.count", { count: rows.length })}</p>
        </div>
        <ButtonLink href="/admin/restaurants/new">{t("admin.nav.newRestaurant")}</ButtonLink>
      </div>

      <form role="search" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          {t("common.search")}
        </label>
        <input id="q" name="q" type="search" defaultValue={query} placeholder={t("admin.restaurants.searchPlaceholder")} className={inputClass} />
      </form>

      {rows.length === 0 ? (
        <Card>
          <p>{query ? t("admin.restaurants.noMatches", { query }) : t("admin.restaurants.empty")}</p>
        </Card>
      ) : (
        <>
          {/* Phones: one card per restaurant. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/restaurants/${r.id}`} className="block rounded-[var(--radius-card)] border border-line bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-lg font-extrabold">{r.name}</p>
                    <Badge tone={STATUS_TONE[r.status]}>{t(`admin.status.${r.status}` as MessageKey)}</Badge>
                  </div>
                  <p className="text-muted">
                    {[r.area, PLANS[r.plan].name, r.agent].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-sm text-muted">
                    {t("admin.restaurants.columns.lastUpdate")}: {r.lastUpdate ? formatDate(r.lastUpdate) : t("admin.restaurants.never")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {/* Larger screens: a table. */}
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-card md:block">
            <table className="w-full text-left">
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th className="p-3">{t("admin.restaurants.columns.name")}</th>
                  <th className="p-3">{t("admin.restaurants.columns.plan")}</th>
                  <th className="p-3">{t("admin.restaurants.columns.status")}</th>
                  <th className="p-3">{t("admin.restaurants.columns.area")}</th>
                  <th className="p-3">{t("admin.restaurants.columns.agent")}</th>
                  <th className="p-3">{t("admin.restaurants.columns.lastUpdate")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="p-3">
                      <Link href={`/admin/restaurants/${r.id}`} className="font-bold text-brand underline-offset-2 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="p-3">{PLANS[r.plan].name}</td>
                    <td className="p-3">
                      <Badge tone={STATUS_TONE[r.status]}>{t(`admin.status.${r.status}` as MessageKey)}</Badge>
                    </td>
                    <td className="p-3">{r.area}</td>
                    <td className="p-3">{r.agent ?? t("admin.restaurants.noAgent")}</td>
                    <td className="p-3">{r.lastUpdate ? formatDate(r.lastUpdate) : t("admin.restaurants.never")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
