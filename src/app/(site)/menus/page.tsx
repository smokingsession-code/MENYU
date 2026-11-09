import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Alert, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { CUISINES } from "@/config/cuisines";
import { BRAND } from "@/config/brand";
import { getDirectoryTop } from "@/lib/directory";
import { formatUGX } from "@/lib/money";
import { publicEnv } from "@/lib/env";
import { formatClock, openStatus, type OpeningHours } from "@/lib/hours";
import { getTranslator, type MessageKey } from "@/lib/i18n";
import { imageUrl, pickWidth, type ImageDescriptor } from "@/lib/images/shared";
import { getSiteSettings } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: { absolute: t("directory.metaTitle") },
    description: t("directory.metaDescription"),
    alternates: { canonical: `${publicEnv.siteUrl}/menus` },
    robots: settings.directoryEnabled ? { index: true, follow: true } : { index: false, follow: false },
  };
}

interface Listing {
  name: string;
  slug: string;
  area: string | null;
  cuisines: string[];
  price_range: number | null;
  logo: ImageDescriptor | null;
  opening_hours: OpeningHours;
  featured: boolean;
  dishes: string[];
  /** The listing's best "Sell it today" deal that is on now. */
  deal: { item: string; percent: number; ends_at: string; was: number | null; price: number | null } | null;
}

function kampalaClock(iso: string): string {
  const local = new Date(Date.parse(iso) + 3 * 3_600_000);
  return formatClock(local.getUTCHours() * 60 + local.getUTCMinutes());
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** "Menus near me": approved listings by area, food and price; dishes searchable too. */
export default function DirectoryPage({ searchParams }: PageProps<"/menus">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
      <Suspense fallback={<p className="text-muted">{t("common.loading")}</p>}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The search reads the filters and the visitor's session, so it runs per request. */
async function Directory({ searchParams }: { searchParams: PageProps<"/menus">["searchParams"] }) {
  const params = await searchParams;
  const q = one(params.q).slice(0, 60);
  const area = one(params.area).slice(0, 80);
  const cuisine = one(params.cuisine).slice(0, 40);
  const price = /^[1-4]$/.test(one(params.price)) ? Number(one(params.price)) : null;
  const openOnly = one(params.open) === "1";

  // Signed-in admins may look while the directory is switched off.
  const supabase = await createClient();
  const { data } = await supabase.rpc("directory_search", {
    p_query: q || undefined,
    p_area: area || undefined,
    p_cuisine: cuisine || undefined,
    p_price: price ?? undefined,
    p_limit: 120,
  });
  const result = (data ?? { enabled: false, results: [], areas: [] }) as unknown as { enabled: boolean; results: Listing[]; areas: { area: string; count: number }[] };
  const preview = !result.enabled;
  if (preview && result.results.length === 0 && result.areas.length === 0) notFound();

  await connection();
  const now = new Date();
  const withStatus = result.results.map((l) => {
    const status = openStatus(l.opening_hours, now);
    const deal = l.deal && Date.parse(l.deal.ends_at) > now.getTime() ? l.deal : null;
    return { ...l, deal, open: status.known && status.open };
  });
  const shown = openOnly ? withStatus.filter((l) => l.open) : withStatus;
  // Rankings only when browsing (not searching), so they never hide results.
  const top = q || cuisine || price ? [] : await getDirectoryTop(area || null);

  return (
    <>
      {preview ? <Alert tone="warning">{t("directory.adminPreview")}</Alert> : null}
      <div>
        <h1 className="text-3xl font-extrabold">{t("directory.title")}</h1>
        <p className="text-muted">{t("directory.intro")}</p>
      </div>

      <form method="get" action="/menus" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-card p-4">
        <label htmlFor="dir-q" className="block font-bold">
          {t("directory.search")}
        </label>
        <input id="dir-q" name="q" type="search" defaultValue={q} placeholder={t("directory.searchPlaceholder")} className={inputClass} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="dir-area" className="mb-1 block text-sm font-bold">
              {t("directory.area")}
            </label>
            <select id="dir-area" name="area" defaultValue={area} className={inputClass}>
              <option value="">{t("directory.anyArea")}</option>
              {result.areas.map((a) => (
                <option key={a.area} value={a.area}>
                  {a.area} ({a.count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dir-cuisine" className="mb-1 block text-sm font-bold">
              {t("directory.cuisine")}
            </label>
            <select id="dir-cuisine" name="cuisine" defaultValue={cuisine} className={inputClass}>
              <option value="">{t("directory.anyCuisine")}</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dir-price" className="mb-1 block text-sm font-bold">
              {t("directory.price")}
            </label>
            <select id="dir-price" name="price" defaultValue={price ? String(price) : ""} className={inputClass}>
              <option value="">{t("directory.anyPrice")}</option>
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  {t(`directory.prices.${p}` as MessageKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-3 font-bold">
          <input type="checkbox" name="open" value="1" defaultChecked={openOnly} className="size-5 accent-[var(--color-brand)]" />
          {t("directory.openNow")}
        </label>
        <Button type="submit" className="w-full sm:w-auto">
          {t("directory.show")}
        </Button>
      </form>

      {top.length >= 2 ? (
        <section aria-labelledby="top-title" className="space-y-2 rounded-[var(--radius-card)] border border-line bg-card p-4">
          <h2 id="top-title" className="text-xl font-extrabold">
            {area ? t("directory.topTitle", { area }) : t("directory.topTitleAll")}
          </h2>
          <ol className="space-y-1">
            {top.map((p, i) => (
              <li key={p.slug}>
                <Link href={`/r/${p.slug}`} className="flex min-h-11 items-center gap-3 font-bold">
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {!area && p.area ? <span className="block text-sm font-normal text-muted">{p.area}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">{t("directory.topHint", { brand: BRAND.name })}</p>
        </section>
      ) : null}

      <p className="font-bold" aria-live="polite">
        {t("directory.results", { count: shown.length })}
      </p>
      {shown.length === 0 ? <p className="rounded-xl bg-card p-4">{t("directory.none")}</p> : null}
      <ul className="space-y-3">
        {shown.map((l) => (
          <li key={l.slug}>
            <Link href={`/r/${l.slug}`} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-card p-3">
              {l.logo ? (
                // Stored WebP variants at the right size; next/image would only re-encode them.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl(l.logo, pickWidth(l.logo, 64))}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  className="size-16 shrink-0 rounded-full object-cover"
                  style={{ backgroundColor: l.logo.color }}
                />
              ) : (
                <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-extrabold text-white">
                  {l.name.slice(0, 1)}
                </span>
              )}
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-extrabold">{l.name}</span>
                  {l.featured ? <Badge tone="yellow">{t("directory.featured")}</Badge> : null}
                </span>
                <span className="block text-sm text-muted">
                  {[l.area, ...l.cuisines.slice(0, 2), l.price_range ? t(`directory.prices.${l.price_range}` as MessageKey) : null].filter(Boolean).join(" · ")}
                </span>
                <span className={`block text-sm font-bold ${l.open ? "text-brand" : "text-muted"}`}>{l.open ? t("directory.open") : t("directory.closed")}</span>
                {l.dishes.length ? <span className="block text-sm">{t("directory.matches", { dishes: l.dishes.join(", ") })}</span> : null}
                {l.deal ? (
                  <span className="block rounded-lg bg-accent-soft px-2 py-1 text-sm">
                    <span className="font-extrabold">{t("directory.deal", { item: l.deal.item, percent: l.deal.percent })}</span>
                    {l.deal.price !== null && l.deal.was !== null ? ` · ${t("directory.dealPrice", { price: formatUGX(l.deal.price), was: formatUGX(l.deal.was) })}` : ""}
                    {` · ${t("directory.dealUntil", { time: kampalaClock(l.deal.ends_at) })}`}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
