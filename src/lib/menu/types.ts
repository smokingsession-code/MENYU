import type { PlanCode } from "@/config/plans";
import type { OpeningHours } from "@/lib/hours";
import type { ImageDescriptor } from "@/lib/images/shared";

/** Shape returned by the get_public_menu database function. */
export interface PublicOption {
  id: string;
  kind: "size" | "addon";
  name: string;
  name_lg: string | null;
  price: number;
}

export type ItemTag = "popular" | "spicy" | "vegetarian" | "new";

export interface PublicItem {
  id: string;
  name: string;
  name_lg: string | null;
  description: string | null;
  description_lg: string | null;
  /** Null when the item is priced by size. */
  price: number | null;
  photo: ImageDescriptor | null;
  tags: ItemTag[];
  sold_out: boolean;
  options: PublicOption[];
}

export interface PublicCategory {
  id: string;
  name: string;
  name_lg: string | null;
  items: PublicItem[];
}

export interface PublicSpecial {
  id: string;
  title: string;
  title_lg: string | null;
  description: string | null;
  description_lg: string | null;
  price: number | null;
  days: number[];
  start: string;
  end: string;
  starts_on: string | null;
  ends_on: string | null;
  items: { id: string; name: string; name_lg: string | null; quantity: number }[];
}

export interface PublicMenu {
  version: number;
  plan: PlanCode;
  features: {
    whatsapp_ordering: boolean;
    momo_pay: boolean;
    hide_footer: boolean;
    specials: boolean;
    waiter_call: boolean;
    feedback: boolean;
    table_qr: boolean;
  };
  restaurant: {
    id: string;
    name: string;
    description: string | null;
    description_lg: string | null;
    logo: ImageDescriptor | null;
    cover: ImageDescriptor | null;
    brand_color: string;
    cuisines: string[];
    price_range: number | null;
    is_demo: boolean;
    listed: boolean;
  };
  branch: {
    id: string;
    slug: string;
    name: string | null;
    area: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    phone: string | null;
    whatsapp: string | null;
    opening_hours: OpeningHours;
    accepts_dine_in: boolean;
    accepts_takeaway: boolean;
    accepts_delivery: boolean;
    delivery_note: string | null;
    momo: { mtn_code: string | null; mtn_name: string | null; airtel_code: string | null; airtel_name: string | null } | null;
  };
  categories: PublicCategory[];
  /** Table code (from ?t=) to its name. Empty on plans without table QR codes. */
  tables: Record<string, string>;
  specials: PublicSpecial[];
  has_luganda: boolean;
}

export function sizesOf(item: PublicItem) {
  return item.options.filter((o) => o.kind === "size");
}

export function addonsOf(item: PublicItem) {
  return item.options.filter((o) => o.kind === "addon");
}

/** The lowest price a diner can pay for the item, for "From UGX ..." labels. */
export function startingPrice(item: PublicItem): { price: number | null; from: boolean } {
  const sizes = sizesOf(item);
  if (sizes.length === 0) return { price: item.price, from: false };
  const min = Math.min(...sizes.map((s) => s.price));
  return { price: min, from: sizes.some((s) => s.price !== min) };
}
