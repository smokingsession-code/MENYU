import { getSessionUser } from "@/lib/auth";
import { kitchenBoard } from "@/lib/kitchen";

/**
 * The kitchen screen's refresh (every few seconds). Signed-in team members
 * only; row-level security limits the orders to branches they work at.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const branch = new URL(request.url).searchParams.get("b");
  if (!branch || !UUID.test(branch)) return new Response(null, { status: 400 });
  if (!(await getSessionUser())) return new Response(null, { status: 401 });
  try {
    return Response.json(await kitchenBoard(branch), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[kitchen] refresh failed", { message: (error as Error).message });
    return new Response(null, { status: 503 });
  }
}
