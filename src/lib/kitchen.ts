import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface KitchenTicket {
  id: string;
  number: number | null;
  status: "new" | "cooking" | "ready";
  order_type: "dine_in" | "takeaway" | "delivery";
  table_label: string | null;
  customer_name: string | null;
  payment: "momo" | "cash" | null;
  lines: { name: string; size?: string; addons?: string[]; qty: number; total: number; note?: string; percent_off?: number }[];
  total_ugx: number;
  created_at: string;
  status_at: string;
}

export interface KitchenBoardData {
  tickets: KitchenTicket[];
  doneToday: number;
}

const ACTIVE = ["new", "cooking", "ready"] as const;

/** Kitchen orders still in progress at a branch, oldest first (row-level security decides who sees them). */
export async function kitchenBoard(branchId: string): Promise<KitchenBoardData> {
  const supabase = await createClient();
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, number, status, order_type, table_label, customer_name, payment, lines, total_ugx, created_at, status_at")
      .eq("branch_id", branchId)
      .eq("mode", "kitchen")
      .in("status", [...ACTIVE])
      .order("created_at")
      .limit(200),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .eq("mode", "kitchen")
      .eq("status", "done")
      .eq("local_date", today),
  ]);
  if (error) throw new Error(`kitchen orders: ${error.message}`);
  return { tickets: (data ?? []) as unknown as KitchenTicket[], doneToday: count ?? 0 };
}
