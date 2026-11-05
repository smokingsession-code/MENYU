/**
 * Creates (or rebuilds) the Kijani Café demo restaurant.
 *   npm run seed:demo            local
 *   SEED_ALLOW_REMOTE=1 npm run seed:demo   any project (careful)
 * The demo is marked is_demo: it never opens real WhatsApp chats or shows
 * real payment codes.
 */
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/lib/supabase/database.types";
import { storeImage } from "../src/lib/images/process";
import { adminClient, isLocalUrl } from "./lib";
import { DEMO_SLUG } from "../src/config/demo";
import { DEMO_MENU, DEMO_RESTAURANT, DEMO_SPECIALS } from "./demo-menu";

type Db = SupabaseClient<Database>;

function check<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? "no data"}`);
  }
  return result.data as NonNullable<T>;
}

function slugCode(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A simple, original cover: brand-green gradient with leaf shapes. */
function coverSvg(color: string) {
  const leaves = Array.from({ length: 14 }, (_, i) => {
    const x = (i * 137) % 1600;
    const y = (i * 89) % 900;
    const r = (i * 47) % 360;
    return `<ellipse cx="${x}" cy="${y}" rx="120" ry="40" transform="rotate(${r} ${x} ${y})" fill="#ffffff" opacity="0.08"/>`;
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#14361d"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#g)"/>${leaves}
    <circle cx="1350" cy="170" r="120" fill="#F4B400" opacity="0.85"/>
  </svg>`);
}

function logoSvg(color: string) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="256" fill="${color}"/>
    <path d="M256 110c-70 60-110 120-110 180a110 110 0 0 0 220 0c0-60-40-120-110-180z" fill="#F4B400"/>
    <path d="M256 170v230" stroke="${color}" stroke-width="18" stroke-linecap="round"/>
  </svg>`);
}

export async function seedDemo(db: Db) {
  const existing = await db.from("branches").select("restaurant_id").eq("slug", DEMO_SLUG).maybeSingle();
  if (existing.data) {
    // Rebuild from scratch; the slug is freed by deleting the old restaurant.
    await db.from("restaurants").delete().eq("id", existing.data.restaurant_id);
  }

  const restaurant = check(
    await db
      .from("restaurants")
      .insert({
        name: DEMO_RESTAURANT.name,
        description: DEMO_RESTAURANT.description,
        brand_color: DEMO_RESTAURANT.brandColor,
        cuisines: DEMO_RESTAURANT.cuisines,
        price_range: DEMO_RESTAURANT.priceRange,
        is_demo: true,
        directory_status: "approved",
        is_featured: true,
      })
      .select("id")
      .single(),
    "restaurant",
  );
  const rid = restaurant.id;
  const menu = check(await db.from("menus").insert({ restaurant_id: rid }).select("id").single(), "menu");

  const branch = check(
    await db
      .from("branches")
      .insert({
        restaurant_id: rid,
        menu_id: menu.id,
        slug: DEMO_SLUG,
        area: DEMO_RESTAURANT.area,
        address: DEMO_RESTAURANT.address,
        lat: DEMO_RESTAURANT.lat,
        lng: DEMO_RESTAURANT.lng,
        // Placeholder numbers: demo menus never dial or message them.
        phone: "256700000000",
        whatsapp: "256700000000",
        momo_mtn_code: "000000",
        momo_mtn_name: "KIJANI CAFE (DEMO)",
        momo_airtel_code: "000000",
        momo_airtel_name: "KIJANI CAFE (DEMO)",
        opening_hours: DEMO_RESTAURANT.hours,
        accepts_dine_in: true,
        accepts_takeaway: true,
        accepts_delivery: true,
        delivery_note: DEMO_RESTAURANT.deliveryNote,
        is_main: true,
      })
      .select("id")
      .single(),
    "branch",
  );

  const farFuture = new Date(Date.now() + 10 * 365 * 86_400_000).toISOString();
  check(
    await db
      .from("subscriptions")
      .insert({ restaurant_id: rid, plan: "pro", status: "active", paid_until: farFuture, notes: "Demo restaurant" })
      .select("restaurant_id")
      .single(),
    "subscription",
  );

  const itemIds = new Map<string, string>();
  for (const [ci, section] of DEMO_MENU.entries()) {
    const category = check(
      await db.from("categories").insert({ restaurant_id: rid, menu_id: menu.id, name: section.category, sort_order: ci }).select("id").single(),
      `category ${section.category}`,
    );
    for (const [ii, item] of section.items.entries()) {
      const row = check(
        await db
          .from("items")
          .insert({
            restaurant_id: rid,
            menu_id: menu.id,
            category_id: category.id,
            name: item.name,
            description: item.description ?? null,
            price_ugx: item.sizes ? null : (item.price ?? null),
            tags: item.tags ?? [],
            is_hidden: Boolean(item.hidden),
            sort_order: ii,
          })
          .select("id")
          .single(),
        `item ${item.name}`,
      );
      itemIds.set(item.name, row.id);
      const options = [
        ...(item.sizes ?? []).map(([name, price], i) => ({ kind: "size", name, price_ugx: price, sort_order: i })),
        ...(item.addons ?? []).map(([name, price], i) => ({ kind: "addon", name, price_ugx: price, sort_order: i })),
      ];
      if (options.length) {
        const { error } = await db.from("item_options").insert(options.map((o) => ({ ...o, restaurant_id: rid, item_id: row.id })));
        if (error) throw new Error(`options for ${item.name}: ${error.message}`);
      }
      if (item.soldOut) {
        const { error } = await db.from("sold_out").insert({ branch_id: branch.id, item_id: row.id, restaurant_id: rid });
        if (error) throw new Error(`sold out ${item.name}: ${error.message}`);
      }
    }
  }

  const { error: tablesError } = await db.from("tables").insert(
    DEMO_RESTAURANT.tables.map((label, i) => ({ restaurant_id: rid, branch_id: branch.id, label, code: slugCode(label), sort_order: i })),
  );
  if (tablesError) throw new Error(`tables: ${tablesError.message}`);

  for (const [si, s] of DEMO_SPECIALS.entries()) {
    const special = check(
      await db
        .from("specials")
        .insert({
          restaurant_id: rid,
          title: s.title,
          description: s.description,
          price_ugx: s.price,
          days: s.days,
          start_time: s.start,
          end_time: s.end,
          sort_order: si,
        })
        .select("id")
        .single(),
      `special ${s.title}`,
    );
    const { error } = await db.from("special_items").insert(
      s.items.map(([name, quantity]) => ({ special_id: special.id, item_id: itemIds.get(name)!, restaurant_id: rid, quantity })),
    );
    if (error) throw new Error(`special items: ${error.message}`);
  }

  const cover = await storeImage(db, rid, "cover", await sharp(coverSvg(DEMO_RESTAURANT.brandColor)).png().toBuffer());
  const logo = await storeImage(db, rid, "logo", await sharp(logoSvg(DEMO_RESTAURANT.brandColor)).png().toBuffer());
  const { error: imgError } = await db
    .from("restaurants")
    .update({ cover: cover as unknown as Json, logo: logo as unknown as Json })
    .eq("id", rid);
  if (imgError) throw new Error(`images: ${imgError.message}`);

  const visible = DEMO_MENU.flatMap((s) => s.items).filter((i) => !i.hidden).length;
  return { restaurantId: rid, slug: DEMO_SLUG, items: visible };
}

if (require.main === module) {
  if (!isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 if you really mean it.");
  }
  seedDemo(adminClient())
    .then((r) => console.log(`Demo ready: /r/${r.slug} (${r.items} items)`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
