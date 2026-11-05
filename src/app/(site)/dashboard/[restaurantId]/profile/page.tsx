import Link from "next/link";
import { Alert } from "@/components/ui/card";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { photoStrings } from "@/lib/dashboard-strings";

const t = getTranslator("en");

export default async function ProfilePage({ params }: PageProps<"/dashboard/[restaurantId]/profile">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const b = ctx.branch;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{t("profile.title")}</h1>
        <p className="text-muted">{t("profile.intro")}</p>
      </div>
      {!ctx.canManage ? (
        <Alert tone="warning">
          {ctx.plan === "free" ? t("editor.freeNotice") : t("editor.viewOnly")}{" "}
          {ctx.plan === "free" ? (
            <Link href={`/dashboard/${restaurantId}/request`} className="underline">
              {t("request.cta")}
            </Link>
          ) : null}
        </Alert>
      ) : (
        <ProfileForm
          restaurantId={restaurantId}
          branchId={b.id}
          initial={{
            name: ctx.name,
            description: ctx.description,
            brandColor: ctx.brandColor,
            logo: ctx.logo,
            cover: ctx.cover,
            cuisines: ctx.cuisines,
            priceRange: ctx.priceRange,
            area: b.area,
            address: b.address,
            lat: b.lat,
            lng: b.lng,
            whatsapp: b.whatsapp,
            phone: b.phone,
            hours: b.openingHours,
            acceptsDineIn: b.acceptsDineIn,
            acceptsTakeaway: b.acceptsTakeaway,
            acceptsDelivery: b.acceptsDelivery,
            deliveryNote: b.deliveryNote,
            momoMtnCode: b.momoMtnCode,
            momoMtnName: b.momoMtnName,
            momoAirtelCode: b.momoAirtelCode,
            momoAirtelName: b.momoAirtelName,
          }}
          s={{ ...sectionStrings("en", "profile"), optional: t("common.optional"), saving: t("common.saving") }}
          photoStrings={photoStrings()}
        />
      )}
    </div>
  );
}
