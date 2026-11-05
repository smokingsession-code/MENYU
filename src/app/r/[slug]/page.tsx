import type { Metadata } from "next";
import { notFound } from "next/navigation";
import en from "../../../../messages/en.json";
import lg from "../../../../messages/lg.json";
import { BRAND } from "@/config/brand";
import { DEMO_SLUG } from "@/config/demo";
import { MenuApp } from "@/components/menu/menu-app";
import { publicEnv } from "@/lib/env";
import { getTranslator } from "@/lib/i18n";
import { imageUrl } from "@/lib/images/shared";
import { getPublicMenu } from "@/lib/menu/data";
import type { PublicMenu } from "@/lib/menu/types";

/**
 * The diner menu. Rendered once, cached for everyone, and expired the moment
 * the owner changes something. The table number (?t=) is read in the
 * browser, so one cached page serves every table.
 */
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return [{ slug: DEMO_SLUG }];
}

const t = getTranslator("en");

export async function generateMetadata({ params }: PageProps<"/r/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  if (!menu) return { title: t("diner.notFoundTitle"), robots: { index: false } };

  const { restaurant, branch } = menu;
  const area = branch.area ?? "";
  const title = area
    ? t("diner.metaTitle", { restaurant: restaurant.name, area })
    : t("diner.metaTitleNoArea", { restaurant: restaurant.name });
  const dishes = menu.categories
    .flatMap((c) => c.items)
    .slice(0, 4)
    .map((i) => i.name.toLowerCase())
    .join(", ");
  const description = t("diner.metaDescription", {
    restaurant: restaurant.name,
    inArea: area ? t("diner.inArea", { area }) : "",
    dishes,
  });
  const url = `${publicEnv.siteUrl}/r/${branch.slug}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    // Only menus with an approved directory listing are indexed by Google.
    robots: restaurant.listed ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: restaurant.cover ? [{ url: imageUrl(restaurant.cover, restaurant.cover.widths.at(-1)!) }] : undefined,
    },
    other: { "theme-color": restaurant.brand_color },
  };
}

/** Only Luganda strings a translator has filled in (empty ones fall back to English). */
function filledIn<T extends object>(tree: T): Partial<T> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      if (value.trim()) out[key] = value;
    } else if (value && typeof value === "object") {
      const nested = filledIn(value as object);
      if (nested && Object.keys(nested).length) out[key] = nested;
    }
  }
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
}

function jsonLd(menu: PublicMenu) {
  const { restaurant, branch } = menu;
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    url: `${publicEnv.siteUrl}/r/${branch.slug}`,
    servesCuisine: restaurant.cuisines,
    address: branch.address
      ? { "@type": "PostalAddress", streetAddress: branch.address, addressLocality: branch.area ?? "Kampala", addressCountry: "UG" }
      : undefined,
    geo: branch.lat !== null && branch.lng !== null ? { "@type": "GeoCoordinates", latitude: branch.lat, longitude: branch.lng } : undefined,
    telephone: branch.phone && !restaurant.is_demo ? `+${branch.phone}` : undefined,
    // The menu itself is the page; listing every dish again here would
    // add kilobytes to every scan for little search benefit.
    hasMenu: `${publicEnv.siteUrl}/r/${branch.slug}`,
    priceRange: restaurant.price_range ? "UGX".repeat(restaurant.price_range) : undefined,
  };
}

export default async function MenuPage({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  if (!menu) notFound();

  return (
    <>
      {menu.restaurant.listed ? (
        <script
          type="application/ld+json"
          // Escape "<" so menu text can never close the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(menu)).replace(/</g, "\\u003c") }}
        />
      ) : null}
      <MenuApp menu={menu} strings={en.diner} lgStrings={filledIn(lg.diner)} brandName={BRAND.name} homeUrl={publicEnv.siteUrl} />
    </>
  );
}
