import { requireAdmin } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { TRIAL } from "@/config/plans";
import { CreateRestaurantForm } from "./create-form";

const t = getTranslator("en");

export default async function NewRestaurantPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "trial_days").maybeSingle();
  const trialDays = typeof data?.value === "number" ? data.value : TRIAL.defaultDays;

  const m = {
    name: t("admin.create.name"),
    namePlaceholder: t("admin.create.namePlaceholder"),
    area: t("admin.create.area"),
    areaPlaceholder: t("admin.create.areaPlaceholder"),
    whatsapp: t("admin.create.whatsapp"),
    whatsappHint: t("admin.create.whatsappHint"),
    ownerSection: t("admin.create.ownerSection"),
    ownerName: t("admin.create.ownerName"),
    ownerPhone: t("admin.create.ownerPhone"),
    ownerPhoneHint: t("admin.create.ownerPhoneHint"),
    ownerEmail: t("admin.create.ownerEmail"),
    ownerEmailHint: t("admin.create.ownerEmailHint"),
    trialDays: t("admin.create.trialDays"),
    trialDaysHint: t("admin.create.trialDaysHint"),
    agentCode: t("admin.create.agentCode"),
    optional: t("common.optional"),
    submit: t("admin.create.submit"),
    submitting: t("admin.create.submitting"),
    createdTitle: t("admin.created.title", { restaurant: "{restaurant}" }),
    createdBody: t("admin.created.body"),
    menuLink: t("admin.created.menuLink"),
    inviteLink: t("admin.created.inviteLink"),
    sendWhatsApp: t("admin.created.sendWhatsApp"),
    copyLink: t("admin.created.copyLink"),
    copied: t("common.copied"),
    openRestaurant: t("admin.created.openRestaurant"),
    createAnother: t("admin.created.createAnother"),
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{t("admin.create.title")}</h1>
        <p className="text-muted">{t("admin.create.intro")}</p>
      </div>
      <CreateRestaurantForm m={m} defaultTrialDays={trialDays} />
    </div>
  );
}
