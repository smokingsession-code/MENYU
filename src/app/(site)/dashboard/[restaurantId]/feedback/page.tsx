import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { FeedbackList, Stars, type FeedbackRow } from "@/components/dashboard/feedback-list";
import { planHas } from "@/config/plans";
import { featureBlock, getDashboardContext } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/dates";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { NotAvailable } from "@/components/dashboard/not-available";

const t = getTranslator("en");

export default async function FeedbackPage({ params }: PageProps<"/dashboard/[restaurantId]/feedback">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const base = `/dashboard/${restaurantId}`;

  if (featureBlock(ctx, "feedback") === "switch") return <NotAvailable title={t("feedback.title")} backHref={base} />;
  if (!planHas(ctx.plan, "feedback")) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("feedback.title")}</h1>
        <p>{t("feedback.proOnly")}</p>
        {ctx.role !== "staff" ? (
          <ButtonLink href={`${base}/billing`} className="w-full">
            {t("home2.proUpsellCta")}
          </ButtonLink>
        ) : null}
      </Card>
    );
  }

  const supabase = await createClient();
  const [{ data: latest }, { data: ratings }, { data: tables }] = await Promise.all([
    supabase
      .from("feedback")
      .select("id, rating, comment, table_code, read_at, created_at")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("feedback").select("rating").eq("restaurant_id", restaurantId).is("deleted_at", null).limit(5000),
    supabase.from("tables").select("code, label").eq("restaurant_id", restaurantId).is("deleted_at", null),
  ]);

  const all = ratings ?? [];
  const average = all.length ? all.reduce((n, r) => n + r.rating, 0) / all.length : 0;
  const labels = new Map((tables ?? []).map((tb) => [tb.code, tb.label]));
  const rows: FeedbackRow[] = (latest ?? []).map((f) => ({
    id: f.id,
    rating: f.rating,
    comment: f.comment,
    table: f.table_code ? (labels.get(f.table_code) ?? f.table_code) : null,
    when: formatDateTime(f.created_at),
    unread: f.read_at === null,
  }));
  const s = sectionStrings("en", "feedback");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("feedback.title")}</h1>
        <p className="text-muted">{t("feedback.intro")}</p>
      </div>
      {all.length ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{t("feedback.average")}</p>
            <p className="text-4xl font-extrabold">{average.toFixed(1)}</p>
          </div>
          <div className="text-right">
            <Stars rating={average} label={t("feedback.stars", { count: average.toFixed(1) })} />
            <p className="text-sm text-muted">{t("feedback.count", { count: all.length })}</p>
          </div>
        </Card>
      ) : (
        <p className="rounded-xl bg-card p-4 text-lg">{t("feedback.empty")}</p>
      )}
      <FeedbackList restaurantId={restaurantId} rows={rows} canDelete={ctx.role !== "staff"} s={s} />
    </div>
  );
}
