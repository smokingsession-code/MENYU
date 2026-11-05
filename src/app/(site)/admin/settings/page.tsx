import { Card } from "@/components/ui/card";
import { SettingsForm } from "@/components/admin/settings-form";
import { requireAdmin } from "@/lib/auth";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { formatPhoneLocal } from "@/lib/phone";
import { getBillingSettings } from "@/lib/settings";

const t = getTranslator("en");

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await getBillingSettings();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">{t("admin.settings.title")}</h1>
      <Card>
        <SettingsForm
          initial={{
            trialDays: String(settings.trialDays),
            graceDays: String(settings.graceDays),
            mtnCode: settings.momo.mtn_code,
            mtnName: settings.momo.mtn_name,
            airtelCode: settings.momo.airtel_code,
            airtelName: settings.momo.airtel_name,
            supportWhatsapp: settings.supportWhatsapp ? formatPhoneLocal(settings.supportWhatsapp) : "",
            agentCommissionUgx: String(settings.agentCommissionUgx),
            referralMonths: String(settings.referralMonths),
          }}
          s={sectionStrings("en", "admin")}
        />
      </Card>
    </div>
  );
}
