import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { TablesManager } from "@/components/dashboard/tables-manager";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { loadPrintableRestaurant, printedTableLabel } from "@/lib/qr-access";

const t = getTranslator("en");

export default async function TablesPage({ params }: PageProps<"/dashboard/[restaurantId]/tables">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const printable = await loadPrintableRestaurant(restaurantId);
  if (!printable) notFound();
  const branch = printable.branches.find((b) => b.id === ctx.branch.id) ?? printable.branches[0];
  const base = `/api/qr/${restaurantId}?branch=${branch.id}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{t("tables.title")}</h1>
        <p className="text-muted">{t("tables.intro")}</p>
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{t("qr.printTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <a href={`/api/print/${restaurantId}?branch=${branch.id}&layout=tents`} className={buttonClass("primary", "md", "w-full")} download>
              {t("qr.tents")}
            </a>
            <p className="text-sm text-muted">{t("qr.tentsHint")}</p>
          </div>
          <div className="space-y-1">
            <a href={`/api/print/${restaurantId}?branch=${branch.id}&layout=stickers`} className={buttonClass("outline", "md", "w-full")} download>
              {t("qr.stickers")}
            </a>
            <p className="text-sm text-muted">{t("qr.stickersHint")}</p>
          </div>
        </div>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-extrabold">{t("qr.wholeRestaurant")}</p>
          <p className="text-sm text-muted">{t("qr.wholeRestaurantHint")}</p>
        </div>
        <div className="flex gap-2">
          <a href={`${base}&format=png`} className={buttonClass("outline", "sm")} download>
            PNG
          </a>
          <a href={`${base}&format=svg`} className={buttonClass("outline", "sm")} download>
            SVG
          </a>
        </div>
      </Card>

      {printable.tableCodes && ctx.canManage ? (
        <Card>
          <h2 className="mb-3 text-lg font-extrabold">{t("qr.tablesTitle")}</h2>
          <TablesManager
            restaurantId={restaurantId}
            branchId={branch.id}
            tables={branch.tables.map((table) => ({ id: table.id, label: table.label, printed: printedTableLabel(table.label) }))}
            s={sectionStrings("en", "tables")}
          />
        </Card>
      ) : (
        <Alert tone="warning">
          {t("tables.freePlan")}{" "}
          {ctx.plan === "free" ? (
            <Link href={`/dashboard/${restaurantId}/request`} className="underline">
              {t("request.cta")}
            </Link>
          ) : null}
        </Alert>
      )}
    </div>
  );
}
