import "server-only";
import { revalidateTag, updateTag } from "next/cache";
import { restaurantMenuTag } from "./data";

/**
 * Call after any change that diners should see. In a Server Action the next
 * menu request waits for fresh data (owners see their change at once);
 * elsewhere (cron jobs, webhooks) the cached menu is dropped immediately.
 */
export function expireMenu(restaurantId: string, context: "action" | "background" = "action") {
  if (context === "action") updateTag(restaurantMenuTag(restaurantId));
  else revalidateTag(restaurantMenuTag(restaurantId), { expire: 0 });
}
