import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { OnboardingForm } from "./onboarding-form";

const t = getTranslator("en");

export const metadata: Metadata = { title: t("onboarding.title"), robots: { index: false } };

async function Gate({ children }: { children: React.ReactNode }) {
  await requireUser("/onboarding");
  return <>{children}</>;
}

export default function OnboardingPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-4 py-6">
        <div>
          <h1 className="text-2xl font-extrabold">{t("onboarding.title")}</h1>
          <p className="text-muted">{t("onboarding.intro")}</p>
        </div>
        <Card>
          <Suspense fallback={<p className="text-muted">{t("common.loading")}</p>}>
            <Gate>
              <OnboardingForm s={{ ...sectionStrings("en", "onboarding"), optional: t("common.optional") }} />
            </Gate>
          </Suspense>
        </Card>
      </main>
    </>
  );
}
