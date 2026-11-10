import "server-only";
import { revalidateTag, updateTag } from "next/cache";
import { ALL_MENUS_TAG, restaurantMenuTag } from "./data";

/**
 * Call after any change that diners should see. In a Server Action the next
 * menu request waits for fresh data (owners see their change at once);
 * elsewhere (cron jobs, webhooks) the cached menu is dropped immediately.
 */
export function expireMenu(restaurantId: string, context: "action" | "background" = "action") {
  if (context === "action") updateTag(restaurantMenuTag(restaurantId));
  else revalidateTag(restaurantMenuTag(restaurantId), { expire: 0 });
}

/** After a global feature switch change: every restaurant's menu, at once. */
export function expireAllMenus(context: "action" | "background" = "action") {
  if (context === "action") updateTag(ALL_MENUS_TAG);
  else revalidateTag(ALL_MENUS_TAG, { expire: 0 });
}
