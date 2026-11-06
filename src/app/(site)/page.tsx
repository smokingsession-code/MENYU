import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/config/brand";
import { DEMO_SLUG } from "@/config/demo";
import { PLANS, type PlanCode } from "@/config/plans";
import { ButtonAnchor, ButtonLink } from "@/components/ui/button";
import { publicEnv } from "@/lib/env";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { formatUGX } from "@/lib/money";
import { getSiteSettings } from "@/lib/site-settings";
import { waLink } from "@/lib/whatsapp";

const t = getTranslator("en");

export const metadata: Metadata = {
  title: { absolute: t("home.metaTitle") },
  description: t("home.metaDescription"),
  alternates: { canonical: publicEnv.siteUrl },
  openGraph: { title: t("home.metaTitle"), description: t("home.metaDescription"), url: publicEnv.siteUrl, type: "website" },
};

const BENEFITS = ["print", "orders", "momo", "phones"] as const;
const STEPS = ["one", "two", "three"] as const;

function price(code: PlanCode): { main: string; note: string | null } {
  const plan = PLANS[code];
  if (code === "free") return { main: formatUGX(0), note: null };
  return {
    main: `${formatUGX(plan.priceMonthlyUgx)} ${plan.pricePerBranch ? t("home.perBranch") : t("home.perMonth")}`,
    note: plan.priceYearlyUgx ? t("home.orYear", { amount: formatUGX(plan.priceYearlyUgx) }) : null,
  };
}

/** The marketing site: static, light, and about saving money and getting orders. */
export default async function Home() {
  const settings = await getSiteSettings();
  const chat = settings.supportWhatsapp ? waLink(settings.supportWhatsapp, t("home.chatMessage")) : null;
  const features = sectionStrings("en", "billing");
  const featureList = (code: PlanCode) =>
    Object.entries(features)
      .filter(([key]) => key.startsWith(`features.${code}.`))
      .map(([, text]) => text);

  return (
    <main className="flex-1">
      <section className="bg-brand text-white">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-12 sm:py-16">
          <p className="text-2xl font-extrabold">{BRAND.name}</p>
          <h1 className="max-w-2xl text-4xl font-extrabold leading-tight sm:text-5xl">{t("home.tagline")}</h1>
          <p className="max-w-xl text-lg text-white/90">{t("home.intro")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={`/r/${DEMO_SLUG}`} size="lg">
              {t("home.demo")}
            </ButtonLink>
            {chat ? (
              <ButtonAnchor href={chat} target="_blank" rel="noopener noreferrer" size="lg" variant="outline" className="border-white bg-transparent text-white hover:bg-white/10">
                {t("home.chat")}
              </ButtonAnchor>
            ) : null}
          </div>
          <p>
            <Link href="/login" className="inline-flex min-h-11 items-center font-bold text-white underline underline-offset-4">
              {t("home.signIn")}
            </Link>
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl space-y-5 px-4 py-12">
        <h2 className="text-2xl font-extrabold">{t("home.benefitsTitle")}</h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {BENEFITS.map((b) => (
            <li key={b} className="rounded-[var(--radius-card)] border border-line bg-card p-5">
              <h3 className="text-lg font-extrabold">{t(`home.benefits.${b}`)}</h3>
              <p className="mt-1 text-muted">{t(`home.benefits.${b}Body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-card">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-12">
          <h2 className="text-2xl font-extrabold">{t("home.stepsTitle")}</h2>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step} className="space-y-2">
                <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-accent text-xl font-extrabold">
                  {i + 1}
                </span>
                <h3 className="text-lg font-extrabold">{t(`home.steps.${step}`)}</h3>
                <p className="text-muted">{t(`home.steps.${step}Body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl space-y-5 px-4 py-12" aria-labelledby="pricing">
        <div>
          <h2 id="pricing" className="text-2xl font-extrabold">
            {t("home.pricingTitle")}
          </h2>
          <p className="text-muted">{t("home.pricingIntro", { days: settings.trialDays })}</p>
        </div>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(["free", "standard", "pro"] as const).map((code) => {
            const p = price(code);
            return (
              <li key={code} className={`space-y-3 rounded-[var(--radius-card)] border-2 bg-card p-5 ${code === "standard" ? "border-brand" : "border-line"}`}>
                <h3 className="text-xl font-extrabold">{PLANS[code].name}</h3>
                <p>
                  <span className="text-2xl font-extrabold">{p.main}</span>
                  {p.note ? <span className="block text-sm text-muted">{p.note}</span> : null}
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {featureList(code).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
        <ButtonLink href="/login" size="lg" className="w-full sm:w-auto">
          {t("home.start")}
        </ButtonLink>
      </section>

      {settings.directoryEnabled ? (
        <section className="mx-auto w-full max-w-5xl px-4 pb-6">
          <Link href="/menus" className="block rounded-[var(--radius-card)] border-2 border-accent bg-accent-soft p-5 text-lg font-extrabold">
            {t("home.directory")} →
          </Link>
        </section>
      ) : null}

      <section className="bg-brand text-white">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-12 text-center">
          <h2 className="text-2xl font-extrabold">{t("home.finalTitle")}</h2>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {chat ? (
              <ButtonAnchor href={chat} target="_blank" rel="noopener noreferrer" size="lg">
                {t("home.chat")}
              </ButtonAnchor>
            ) : null}
            <ButtonLink href={`/r/${DEMO_SLUG}`} size="lg" variant="outline" className="border-white bg-transparent text-white hover:bg-white/10">
              {t("home.demo")}
            </ButtonLink>
          </div>
          <p className="text-sm text-white/80">
            {BRAND.name} · {BRAND.tagline} · {t("home.footerNote")}
          </p>
        </div>
      </section>
    </main>
  );
}
