import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n";
import { loadPrintableRestaurant, printedTableLabel } from "@/lib/qr-access";

const t = getTranslator("en");

function Downloads({ restaurantId, branchId, tableId }: { restaurantId: string; branchId: string; tableId?: string }) {
  const base = `/api/qr/${restaurantId}?branch=${branchId}${tableId ? `&table=${tableId}` : ""}`;
  return (
    <div className="flex gap-2">
      <a href={`${base}&format=png`} className={buttonClass("outline", "sm")} download>
        {t("qr.png")}
      </a>
      <a href={`${base}&format=svg`} className={buttonClass("outline", "sm")} download>
        {t("qr.svg")}
      </a>
    </div>
  );
}

export default async function QrPage({ params }: PageProps<"/dashboard/[restaurantId]/qr">) {
  const { restaurantId } = await params;
  const restaurant = await loadPrintableRestaurant(restaurantId);
  if (!restaurant) notFound();

  return (
    <div className="space-y-5">
      <Link href={`/dashboard/${restaurantId}`} className="inline-flex min-h-11 items-center font-bold text-brand">
        ← {t("qr.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold">{t("qr.title")}</h1>
        <p className="text-muted">{t("qr.intro")}</p>
      </div>
      {!restaurant.tableCodes ? <Alert tone="warning">{t("qr.freePlan")}</Alert> : null}

      {restaurant.branches.map((branch) => (
        <div key={branch.id} className="space-y-4">
          {restaurant.branches.length > 1 ? <h2 className="text-xl font-extrabold">{branch.name ?? branch.slug}</h2> : null}

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
            <Downloads restaurantId={restaurantId} branchId={branch.id} />
          </Card>

          {restaurant.tableCodes ? (
            <Card className="space-y-2">
              <h2 className="text-lg font-extrabold">{t("qr.tablesTitle")}</h2>
              {branch.tables.length === 0 ? <p className="text-muted">{t("qr.noTables")}</p> : null}
              <ul className="divide-y divide-line">
                {branch.tables.map((table) => (
                  <li key={table.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-bold">{printedTableLabel(table.label)}</span>
                    <Downloads restaurantId={restaurantId} branchId={branch.id} tableId={table.id} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ))}
    </div>
  );
}
