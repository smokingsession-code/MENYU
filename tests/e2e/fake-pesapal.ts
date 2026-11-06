import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * A stand-in for Pesapal API 3.0 for browser tests, answering with the
 * shapes in Pesapal's documentation. Its checkout page has one button that
 * "pays with MTN": the order is marked completed, the IPN is sent to the app
 * (and its reply kept), then the browser goes back to the callback URL, the
 * way Pesapal does it.
 */
export interface FakeOrder {
  id: string;
  trackingId: string;
  amount: number;
  currency: string;
  callbackUrl: string;
  paid: boolean;
  ipnReplies: unknown[];
}

export async function startFakePesapal(port: number, appIpnUrl: string): Promise<{ server: Server; orders: Map<string, FakeOrder>; stop: () => Promise<void> }> {
  const orders = new Map<string, FakeOrder>();
  const readBody = (req: import("node:http").IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
  const json = (res: import("node:http").ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method === "POST" && url.pathname === "/api/Auth/RequestToken") {
      return json(res, { token: "fake-token", expiryDate: new Date(Date.now() + 5 * 60_000).toISOString(), error: null, status: "200", message: "Request processed successfully" });
    }
    if (req.method === "POST" && url.pathname === "/api/Transactions/SubmitOrderRequest") {
      if (req.headers.authorization !== "Bearer fake-token") return json(res, { error: { message: "Unauthorized" } }, 401);
      const body = JSON.parse(await readBody(req)) as { id: string; amount: number; currency: string; callback_url: string };
      const order: FakeOrder = { id: body.id, trackingId: randomUUID(), amount: body.amount, currency: body.currency, callbackUrl: body.callback_url, paid: false, ipnReplies: [] };
      orders.set(order.trackingId, order);
      return json(res, {
        order_tracking_id: order.trackingId,
        merchant_reference: order.id,
        redirect_url: `http://127.0.0.1:${port}/checkout/${order.trackingId}`,
        error: null,
        status: "200",
      });
    }
    if (req.method === "GET" && url.pathname === "/api/Transactions/GetTransactionStatus") {
      const order = orders.get(url.searchParams.get("orderTrackingId") ?? "");
      if (!order) return json(res, { error: { error_type: "api_error", code: "invalid", message: "Order not found" }, status: "500" });
      return json(res, {
        payment_method: order.paid ? "MTN" : "",
        amount: order.amount,
        created_date: new Date().toISOString().replace("Z", ""),
        confirmation_code: order.paid ? `MP${order.trackingId.slice(0, 8).toUpperCase()}` : "",
        payment_status_description: order.paid ? "Completed" : "INVALID",
        status_code: order.paid ? 1 : 0,
        merchant_reference: order.id,
        currency: order.currency,
        error: { error_type: null, code: null, message: null, call_back_url: null },
        status: "200",
      });
    }
    const checkout = /^\/checkout\/([0-9a-f-]+)(\/pay)?$/.exec(url.pathname);
    const order = checkout ? orders.get(checkout[1]) : undefined;
    if (checkout && order && !checkout[2]) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        `<!doctype html><title>Pesapal (test)</title><h1>Pay UGX ${order.amount}</h1><form method="post" action="/checkout/${order.trackingId}/pay"><button>Pay with MTN</button></form>`,
      );
    }
    if (checkout && order && checkout[2] && req.method === "POST") {
      order.paid = true;
      const ipn = await fetch(appIpnUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ OrderNotificationType: "IPNCHANGE", OrderTrackingId: order.trackingId, OrderMerchantReference: order.id }),
      });
      order.ipnReplies.push(await ipn.json().catch(() => null));
      const back = new URL(order.callbackUrl);
      back.searchParams.set("OrderTrackingId", order.trackingId);
      back.searchParams.set("OrderMerchantReference", order.id);
      back.searchParams.set("OrderNotificationType", "CALLBACKURL");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, orders, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}
