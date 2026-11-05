import { Badge, Card } from "@/components/ui/card";
import { RequestForm } from "@/components/dashboard/request-form";
import { requireRestaurantAccess } from "@/lib/auth";
import { getDashboardContext } from "@/lib/dashboard";
import { formatDate } from "@/lib/dates";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { formatPhoneLocal } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export default async function RequestPage({ params, searchParams }: PageProps<"/dashboard/[restaurantId]/request">) {
  const { restaurantId } = await params;
  const { kind: kindParam } = await searchParams;
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const ctx = await getDashboardContext(restaurantId);
  const kind = kindParam === "setup" ? "setup" : "change";

  const supabase = await createClient();
  const { data: previous } = await supabase
    .from("setup_requests")
    .select("id, kind, status, notes, created_at")
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{kind === "setup" ? t("request.setupTitle") : t("request.title")}</h1>
        <p className="text-muted">{kind === "setup" ? t("request.setupIntro") : t("request.intro")}</p>
      </div>
      <Card>
        <RequestForm
          restaurantId={restaurantId}
          kind={kind}
          defaultPhone={ctx.branch.whatsapp ? formatPhoneLocal(ctx.branch.whatsapp) : ""}
          s={{ ...sectionStrings("en", "request"), optional: t("common.optional") }}
          uploadStrings={sectionStrings("en", "uploads")}
        />
      </Card>
      {previous && previous.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("request.previous")}</h2>
          <ul className="divide-y divide-line">
            {previous.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm text-muted">{formatDate(r.created_at)}</span>
                  <span className="line-clamp-2">{r.notes ?? "—"}</span>
                </span>
                <Badge tone={r.status === "done" ? "green" : r.status === "cancelled" ? "grey" : "yellow"}>
                  {t(`request.status.${r.status}` as MessageKey)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
