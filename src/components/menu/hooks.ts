"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addLine, randomRef, setQty as setLineQty, type CartLine, type OrderLineInput, type OrderMode, type OrderType, type PaymentChoice } from "@/lib/order";

/** "{name} costs {price}" with values filled in. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function storageGet<T>(key: string, storage: "local" | "session" = "local"): T | null {
  try {
    const raw = (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: unknown, storage: "local" | "session" = "local") {
  try {
    (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the cart just won't survive a reload.
  }
}

const CART_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * The cart, kept per menu in localStorage for 12 hours. Each cart has a
 * random order ref: showing or sending the same cart again updates the same
 * order; a new cart gets a new ref.
 */
export function useCart(slug: string) {
  const key = `menyu:cart:${slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ref, setRef] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    const saved = storageGet<{ lines: CartLine[]; at: number; ref?: string }>(key);
    const fresh = saved && Date.now() - saved.at < CART_TTL_MS && Array.isArray(saved.lines);
    // Restoring from storage after hydration keeps server and client HTML identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh) setLines(saved.lines);
    setRef(fresh && saved.ref && /^[A-Za-z0-9]{12,40}$/.test(saved.ref) ? saved.ref : randomRef());
    loaded.current = true;
  }, [key]);

  useEffect(() => {
    if (loaded.current) storageSet(key, { lines, at: Date.now(), ref });
  }, [key, lines, ref]);

  return {
    lines,
    ref,
    add: useCallback((line: CartLine) => setLines((current) => addLine(current, line)), []),
    setQty: useCallback((lineKey: string, qty: number) => setLines((current) => setLineQty(current, lineKey, qty)), []),
    setNote: useCallback(
      (lineKey: string, note: string) => setLines((current) => current.map((l) => (l.key === lineKey ? { ...l, note } : l))),
      [],
    ),
    clear: useCallback(() => {
      setLines([]);
      setRef(randomRef());
    }, []),
  };
}

/**
 * This phone's random loyalty id (only for restaurants with loyalty stamps).
 * The server stores a hash of it; it never identifies the person.
 */
export function deviceId(): string | null {
  let id = storageGet<string>("menyu:did");
  if (!id || !/^[A-Za-z0-9]{16,64}$/.test(id)) {
    id = randomRef(24);
    storageSet("menyu:did", id);
    // Storage off (private mode): no stable id, so no stamps.
    if (storageGet<string>("menyu:did") !== id) return null;
  }
  return id;
}

export interface LoyaltyState {
  stamps: number;
  visits: number;
  ready: boolean;
  earned: boolean;
  stamped_today: boolean;
  last_used_at: string | null;
}

export interface ServerOrder {
  ref: string;
  number: number | null;
  mode: OrderMode;
  status: "sent" | "new" | "cooking" | "ready" | "done" | "cancelled";
  status_at: string;
  total: number;
  item_count: number;
  lines: { name: string; size?: string; addons?: string[]; qty: number; unit: number; total: number; note?: string; percent_off?: number }[];
  created_at: string;
}

export interface OrderResponse {
  result: "ok" | "sold_out" | "changed" | "mode_changed" | "invalid" | "too_many" | "not_found" | "not_available" | "error";
  order?: ServerOrder;
  loyalty?: LoyaltyState | null;
  items?: string[];
}

export interface OrderRequest {
  slug: string;
  ref: string;
  mode: OrderMode;
  type: OrderType;
  table?: string | null;
  tableLabel?: string;
  name?: string;
  address?: string;
  payment?: PaymentChoice | null;
  lines: OrderLineInput[];
  device?: string | null;
}

/** Records or sends an order. keepalive lets it finish while WhatsApp opens. */
export async function sendOrder(request: OrderRequest): Promise<OrderResponse> {
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      keepalive: true,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as OrderResponse | null;
    return json && typeof json.result === "string" ? json : { result: "error" };
  } catch {
    return { result: "error" };
  }
}

const KITCHEN_TTL_MS = 4 * 60 * 60 * 1000;
const FINISHED = new Set(["done", "cancelled"]);

/**
 * The phone's latest kitchen order at this restaurant, remembered for four
 * hours and refreshed every 10 seconds while it is being prepared.
 */
export function useKitchenOrder(slug: string) {
  const key = `menyu:kitchen:${slug}`;
  const [order, setOrder] = useState<ServerOrder | null>(null);

  useEffect(() => {
    const saved = storageGet<ServerOrder>(key);
    const fresh = saved && Date.now() - Date.parse(saved.created_at) < KITCHEN_TTL_MS && saved.status !== "done";
    // Read after hydration so server and client HTML match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh) setOrder(saved);
  }, [key]);

  const ref = order?.ref;
  const status = order?.status;
  useEffect(() => {
    if (!ref || !status || FINISHED.has(status)) return;
    let timer: number | undefined;
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/orders?s=${encodeURIComponent(slug)}&ref=${encodeURIComponent(ref)}`, { cache: "no-store" });
          const json = res.ok ? ((await res.json()) as { order?: ServerOrder }) : null;
          if (!stopped && json?.order) {
            const next = json.order;
            setOrder(next);
            storageSet(key, next);
            if (next.status === "ready" && status !== "ready") navigator.vibrate?.([200, 100, 200]);
          }
        } catch {
          // Offline for a moment: try again next time.
        }
      }
      if (!stopped) timer = window.setTimeout(poll, 10_000);
    };
    timer = window.setTimeout(poll, 10_000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [key, slug, ref, status]);

  const set = useCallback(
    (next: ServerOrder | null) => {
      setOrder(next);
      if (next) storageSet(key, next);
      else {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
    },
    [key],
  );
  return [order, set] as const;
}

/** A random id for this visit, so views can be counted without knowing who anyone is. */
function sessionId(): string {
  let id = storageGet<string>("menyu:sid", "session");
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    storageSet("menyu:sid", id, "session");
  }
  return id;
}

export type EventType = "menu_view" | "item_view" | "whatsapp_order" | "order_copy" | "waiter_call" | "bill_request" | "momo_view";

interface EventPayload {
  s: string;
  t: EventType;
  tb?: string | null;
  i?: string;
  sid?: string;
  did?: string;
}

/** Fire-and-forget analytics (sendBeacon survives the page opening WhatsApp). */
export function track(slug: string, type: EventType, extra: { table?: string | null; itemId?: string } = {}) {
  const payload: EventPayload = { s: slug, t: type, tb: extra.table ?? undefined, i: extra.itemId, sid: sessionId() };
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon?.("/api/e", new Blob([body], { type: "text/plain" }))) return;
  } catch {
    // fall back to fetch
  }
  fetch("/api/e", { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => undefined);
}

export interface LiveState {
  version: number;
  sold_out: string[];
  /** This phone's loyalty card, when the restaurant has stamps. */
  loyalty?: LoyaltyState | null;
}

/**
 * Records the menu view and, in the same request, gets the current version
 * and sold-out list. A menu served from the phone's cache is corrected
 * straight away.
 */
export function useLiveMenu(slug: string, table: string | null, ready: boolean, onLive: (live: LiveState) => void, withLoyalty = false) {
  const sent = useRef(false);
  const callback = useRef(onLive);
  useEffect(() => {
    callback.current = onLive;
  });

  useEffect(() => {
    if (!ready || sent.current) return;
    sent.current = true;
    const did = withLoyalty ? deviceId() : null;
    const payload: EventPayload = { s: slug, t: "menu_view", tb: table, sid: sessionId(), ...(did ? { did } : {}) };
    fetch("/api/e", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "text/plain" }, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<LiveState>) : null))
      .then((live) => {
        if (live && typeof live.version === "number") callback.current(live);
      })
      .catch(() => undefined);
  }, [slug, table, ready, withLoyalty]);
}

/** The table code from the QR link (?t=5), read once after hydration. */
export function useTableCode(): { code: string | null; ready: boolean } {
  const [state, setState] = useState<{ code: string | null; ready: boolean }>({ code: null, ready: false });
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("t");
    const code = raw && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw) && raw.length <= 24 ? raw : null;
    // window.location only exists in the browser, so this runs after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ code, ready: true });
  }, []);
  return state;
}

/** Remembers the diner's language choice for this device. */
export function useLanguage(enabled: boolean): ["en" | "lg", (lang: "en" | "lg") => void] {
  const [lang, setLang] = useState<"en" | "lg">("en");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled && storageGet<string>("menyu:lang") === "lg") setLang("lg");
  }, [enabled]);
  const choose = useCallback((next: "en" | "lg") => {
    setLang(next);
    storageSet("menyu:lang", next);
  }, []);
  return [enabled ? lang : "en", choose];
}

/** Registers the service worker that keeps menus on the phone for instant second scans. */
export function useServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/r/" }).catch(() => undefined);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
}

/** Must match PAGES in public/sw.js. */
const SW_PAGE_CACHE = "menyu-pages-v1";

/**
 * Loads the latest menu from the network into the phone's cache, then
 * reloads. Reloading alone could show the cached (old) copy again.
 */
export async function refreshMenu(): Promise<void> {
  try {
    const url = `${window.location.origin}${window.location.pathname}`;
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (response.ok && "caches" in window) {
      const cache = await caches.open(SW_PAGE_CACHE);
      await cache.put(new Request(url), response.clone());
    }
  } catch {
    // Offline: the reload shows what we have.
  }
  window.location.reload();
}

/** Auto-refresh at most once per menu version, so a slow network can never loop. */
export function shouldAutoRefresh(slug: string, version: number): boolean {
  const key = `menyu:refreshed:${slug}`;
  try {
    if (Number(window.sessionStorage.getItem(key)) >= version) return false;
    window.sessionStorage.setItem(key, String(version));
    return true;
  } catch {
    return false;
  }
}
