"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRestaurantAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** Owners and staff: feedback they have now seen stops counting as new. */
export async function markFeedbackReadAction(restaurantId: string, ids: string[]): Promise<{ ok: boolean }> {
  await requireRestaurantAccess(restaurantId);
  const valid = ids.filter((id) => uuid.safeParse(id).success).slice(0, 200);
  if (valid.length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase
    .from("feedback")
    .update({ read_at: new Date().toISOString() })
    .eq("restaurant_id", restaurantId)
    .in("id", valid)
    .is("read_at", null);
  return { ok: !error };
}

export async function deleteFeedbackAction(restaurantId: string, id: string): Promise<{ ok: boolean }> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  if (!uuid.safeParse(id).success) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback")
    .update({ deleted_at: new Date().toISOString() })
    .eq("restaurant_id", restaurantId)
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { ok: false };
  refresh();
  return { ok: true };
}
