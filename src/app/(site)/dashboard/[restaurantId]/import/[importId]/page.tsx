import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { DiscardImportButton, ImportProgress, RetryImportButton } from "@/components/dashboard/import-progress";
import { ImportReview, type ImportPhoto } from "@/components/dashboard/import-review";
import { PLANS } from "@/config/plans";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { toDraft } from "@/lib/import/draft";
import { draftZ } from "@/lib/import/draft-schema";
import { canRetry, expireStaleImports, type StoredFile } from "@/lib/import/process";
import { extractionZ } from "@/lib/import/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NotAvailable } from "@/components/dashboard/not-available";

const t = getTranslator("en");

// "Try again" restarts reading in the background of this page's Server Action.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set([
  "not_configured",
  "unreadable",
  "refused",
  "too_long",
  "too_large",
  "busy",
  "too_slow",
  "timeout",
  "rejected",
  "unsupported_file",
  "damaged_file",
  "failed",
]);

export default async function ImportReviewPage({ params }: PageProps<"/dashboard/[restaurantId]/import/[importId]">) {
  const { restaurantId, importId } = await params;
  if (!UUID.test(importId)) notFound();
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.role === "staff") notFound();
  const base = `/dashboard/${restaurantId}`;
  if (ctx.role !== "admin" && !ctx.switches.menu_import) return <NotAvailable title={t("import.title")} backHref={base} />;

  await expireStaleImports(restaurantId);
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("menu_imports")
    .select("id, menu_id, status, files, draft, ai_result, error_code, error_message, attempts, updated_at")
    .eq("id", importId)
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row || row.status === "discarded") notFound();
  const s = { ...sectionStrings("en", "import"), close: t("common.close") };

  if (row.status === "processing" || row.status === "uploaded") {
    return (
      <Card className="py-8">
        <ImportProgress restaurantId={restaurantId} importId={importId} startedAt={row.updated_at} s={s} />
      </Card>
    );
  }

  if (row.status === "published") {
    return (
      <Card className="space-y-3">
        <h1 className="text-2xl font-extrabold">{t("import.publishedTitle")}</h1>
        <p className="text-muted">{t("import.publishedBody")}</p>
        <ButtonLink href={`${base}/menu`} className="w-full">
          {t("import.openEditor")}
        </ButtonLink>
        <ButtonLink href={`${base}/import`} variant="outline" className="w-full">
          {t("import.importMore")}
        </ButtonLink>
      </Card>
    );
  }

  const files = (row.files as unknown as StoredFile[]) ?? [];

  if (row.status === "failed") {
    const code = row.error_code && REASONS.has(row.error_code) ? row.error_code : "failed";
    // For unreadable menus the message is the reader's own explanation; for
    // file problems it is the file's name.
    const name = row.error_message ?? files[0]?.name ?? "";
    const reason = t(`import.errors.reasons.${code}` as MessageKey, { name });
    return (
      <Card className="space-y-4">
        <h1 className="text-2xl font-extrabold">{t("import.failedTitle")}</h1>
        <Alert tone="error">{reason}</Alert>
        {code === "unreadable" && row.error_message ? <p className="text-muted">{t("import.readerNote", { note: row.error_message })}</p> : null}
        {ctx.canEditMenu && canRetry(row.error_code, row.attempts) ? <RetryImportButton restaurantId={restaurantId} importId={importId} s={s} /> : null}
        <ButtonLink href={`${base}/import`} variant="outline" className="w-full">
          {t("import.newPhotos")}
        </ButtonLink>
        <p className="text-center">
          <Link href={`${base}/request?kind=setup`} className="font-bold text-brand underline">
            {t("import.sendUs")}
          </Link>
        </p>
        {ctx.canEditMenu ? <DiscardImportButton restaurantId={restaurantId} importId={importId} s={s} then={`${base}/import`} /> : null}
      </Card>
    );
  }

  // needs_review
  if (!ctx.canEditMenu) {
    return <Alert tone="warning">{t("import.errors.notAllowed")}</Alert>;
  }
  const stored = draftZ.safeParse(row.draft);
  const extraction = extractionZ.safeParse(row.ai_result);
  const draft = stored.success ? stored.data : extraction.success ? toDraft(extraction.data) : null;
  if (!draft) notFound();

  const admin = createAdminClient();
  const [{ count: existing }, { data: signed }] = await Promise.all([
    supabase.from("items").select("id", { count: "exact", head: true }).eq("menu_id", row.menu_id).is("deleted_at", null),
    files.length
      ? admin.storage.from("uploads").createSignedUrls(
          files.map((f) => f.path),
          3600,
        )
      : Promise.resolve({ data: [] as { signedUrl: string | null }[] }),
  ]);
  const photos: ImportPhoto[] = files.flatMap((f, i) => {
    const url = signed?.[i]?.signedUrl;
    return url ? [{ url, isPdf: f.mime === "application/pdf" }] : [];
  });

  return (
    <ImportReview
      restaurantId={restaurantId}
      importId={importId}
      initialDraft={draft}
      photos={photos}
      existingItems={existing ?? 0}
      note={extraction.success ? extraction.data.problem : null}
      freeLimit={ctx.plan === "free" ? PLANS.free.limits.items : null}
      s={s}
      tagLabels={{ popular: t("diner.tags.popular"), spicy: t("diner.tags.spicy"), vegetarian: t("diner.tags.vegetarian"), new: t("diner.tags.new") }}
    />
  );
}
