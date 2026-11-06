import Link from "next/link";
import { Alert, Card } from "@/components/ui/card";
import { DirectoryListing } from "@/components/dashboard/directory-listing";
import { planHas } from "@/config/plans";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { photoStrings } from "@/lib/dashboard-strings";

const t = getTranslator("en");

export default async function ProfilePage({ params }: PageProps<"/dashboard/[restaurantId]/profile">) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const b = ctx.branch;
  const supabase = await createClient();
  const { data: listing } = await supabase.from("restaurants").select("directory_status").eq("id", restaurantId).maybeSingle();

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
            descriptionLg: ctx.descriptionLg,
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
          photoStrings={photoStrings("en", { enhance: planHas(ctx.plan, "photo_enhance") })}
        />
      )}
          {ctx.role !== "staff" ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold">{t("profile.directory.title")}</h2>
          {planHas(ctx.plan, "directory_listing") ? (
            <>
              <p className="text-muted">{t("profile.directory.body")}</p>
              <DirectoryListing restaurantId={restaurantId} status={listing?.directory_status ?? "hidden"} s={sectionStrings("en", "profile")} />
            </>
          ) : (
            <p className="text-muted">{t("profile.directory.freeBody")}</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
