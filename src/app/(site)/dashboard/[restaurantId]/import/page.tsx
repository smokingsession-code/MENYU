import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ImportStart } from "@/components/dashboard/import-start";
import { getDashboardContext } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/dates";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { expireStaleImports, importAvailable } from "@/lib/import/process";
import { createClient } from "@/lib/supabase/server";
import { UPLOAD_LIMITS } from "@/lib/uploads";

const t = getTranslator("en");

// Reading starts in the background of the Server Action on this page
// (Next.js `after`), which shares the page's time limit.
export const maxDuration = 300;

const STATUS_TONE = { needs_review: "yellow", published: "green", failed: "red", processing: "grey", uploaded: "grey", discarded: "grey" } as const;

export default async function ImportPage({ params }: PageProps<"/dashboard/[restaurantId]/import">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;

  if (!ctx.canEditMenu) {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("import.freeTitle")}</h1>
        <p className="text-muted">{t("import.freeBody")}</p>
        <ButtonLink href={`${base}/request?kind=setup`} className="w-full">
          {t("onboarding.sendUs")}
        </ButtonLink>
      </Card>
    );
  }

  await expireStaleImports(restaurantId);
  const supabase = await createClient();
  const { data: recent } = await supabase
    .from("menu_imports")
    .select("id, status, files, created_at")
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const available = importAvailable();
  const s = sectionStrings("en", "import");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{t("import.title")}</h1>
        <p className="text-muted">{t("import.intro")}</p>
      </div>

      {available ? (
        <>
          <Card className="space-y-2">
            <h2 className="text-lg font-extrabold">{t("import.tipsTitle")}</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("import.tips.flat")}</li>
              <li>{t("import.tips.whole")}</li>
              <li>{t("import.tips.order", { max: UPLOAD_LIMITS.maxFiles })}</li>
            </ul>
          </Card>
          <Card>
            <ImportStart
              restaurantId={restaurantId}
              branches={ctx.branches.map((b) => ({ id: b.id, label: b.name ?? [ctx.name, b.area].filter(Boolean).join(" · ") }))}
              s={s}
              uploadStrings={sectionStrings("en", "uploads")}
            />
          </Card>
        </>
      ) : (
        <Alert tone="warning">
          {t("import.errors.unavailable")}{" "}
          <Link href={`${base}/request?kind=setup`} className="underline">
            {t("import.sendUs")}
          </Link>
        </Alert>
      )}

      {recent && recent.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("import.recent")}</h2>
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/import/${r.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-bold">{formatDateTime(r.created_at)}</span>
                    <span className="block text-sm text-muted">
                      {t("import.fileCount", { count: Array.isArray(r.files) ? r.files.length : 0 })}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "grey"}>
                    {t(`import.status.${r.status}` as MessageKey)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
