"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { setOrderStatusAction } from "@/app/(site)/dashboard/[restaurantId]/kitchen/actions";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/card";
import type { KitchenBoardData, KitchenTicket } from "@/lib/kitchen";
import { formatUGX } from "@/lib/money";

type Strings = Record<string, string>;
type Status = KitchenTicket["status"];

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const COLUMNS: Status[] = ["new", "cooking", "ready"];
const NEXT: Record<Status, "cooking" | "ready" | "done"> = { new: "cooking", cooking: "ready", ready: "done" };
const BACK: Partial<Record<Status, Status>> = { cooking: "new", ready: "cooking" };
const POLL_MS = 8_000;

/** A short beep (no sound file to download). Browsers allow it after the first tap on the page. */
function beep(context: AudioContext | null) {
  if (!context) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
  osc.connect(gain).connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + 0.4);
}

/**
 * The kitchen screen: New, Cooking and Ready columns (stacked on a phone,
 * side by side on a tablet). Refreshes every few seconds and beeps for new
 * orders; each tap moves an order along and the diner's phone follows.
 */
export function KitchenBoard({
  restaurantId,
  branchId,
  initial,
  typeLabels,
  paymentLabels,
  s,
}: {
  restaurantId: string;
  branchId: string;
  initial: KitchenBoardData;
  typeLabels: Record<KitchenTicket["order_type"], string>;
  paymentLabels: Record<"momo" | "cash", string>;
  s: Strings;
}) {
  const [data, setData] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [sound, setSound] = useState(true);
  const [, start] = useTransition();
  const audio = useRef<AudioContext | null>(null);
  const known = useRef(new Set(initial.tickets.map((t) => t.id)));

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/kitchen?b=${branchId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as KitchenBoardData;
      const fresh = next.tickets.filter((t) => t.status === "new" && !known.current.has(t.id));
      next.tickets.forEach((t) => known.current.add(t.id));
      if (fresh.length && sound) beep(audio.current);
      setData(next);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [branchId, sound]);

  useEffect(() => {
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      setNow(Date.now());
      timer = window.setTimeout(tick, POLL_MS);
    };
    // The clock is only known in the browser (the first render is the server's).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    timer = window.setTimeout(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // The first tap anywhere allows the beep (browsers block sound until then).
  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const newCount = data.tickets.filter((t) => t.status === "new").length;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = newCount ? `(${newCount}) ${base}` : base;
  }, [newCount]);

  function move(ticket: KitchenTicket, status: Status | "done" | "cancelled") {
    setFailed(false);
    setConfirming(null);
    // Show the change at once; the next refresh confirms it.
    setData((d) => ({
      doneToday: d.doneToday + (status === "done" ? 1 : 0),
      tickets: status === "done" || status === "cancelled" ? d.tickets.filter((t) => t.id !== ticket.id) : d.tickets.map((t) => (t.id === ticket.id ? { ...t, status } : t)),
    }));
    start(async () => {
      const r = await setOrderStatusAction(restaurantId, ticket.id, status);
      if (!r.ok) setFailed(true);
      await load();
    });
  }

  const ago = (iso: string) => {
    if (now === null) return "";
    const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
    return minutes < 1 ? s.justNow : fill(s.minutes, { count: minutes });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-bold text-muted">{fill(s.doneToday, { count: data.doneToday })}</p>
        <label className="flex min-h-11 items-center gap-2 font-bold">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
          {s.sound}
        </label>
      </div>
      {offline ? <Alert tone="warning">{s.offline}</Alert> : null}
      {failed ? <Alert tone="error">{s.failed}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const tickets = data.tickets.filter((t) => t.status === column);
          return (
            <section key={column} aria-labelledby={`col-${column}`} className="space-y-2 rounded-2xl bg-paper p-2">
              <h2 id={`col-${column}`} className="flex items-center justify-between px-1 text-lg font-extrabold">
                {s[`columns.${column}`]}
                <span className="rounded-full bg-card px-2.5 text-base tabular-nums">{tickets.length}</span>
              </h2>
              {tickets.length === 0 ? <p className="px-1 pb-2 text-sm text-muted">{s.empty}</p> : null}
              <ul className="space-y-2">
                {tickets.map((ticket) => (
                  <li key={ticket.id} className={`space-y-2 rounded-xl border-2 bg-card p-3 ${column === "new" ? "border-accent-dark" : "border-line"}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xl font-extrabold">{fill(s.order, { number: ticket.number ?? "" })}</p>
                      <p className="text-sm text-muted">{ago(ticket.created_at)}</p>
                    </div>
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {ticket.order_type === "dine_in" ? (
                        ticket.table_label ? fill(s.table, { table: ticket.table_label }) : typeLabels.dine_in
                      ) : (
                        <Badge tone="yellow">{typeLabels[ticket.order_type]}</Badge>
                      )}
                      {ticket.customer_name ? <span className="text-muted">· {ticket.customer_name}</span> : null}
                    </p>
                    <ul className="space-y-1">
                      {ticket.lines.map((line, i) => (
                        <li key={i}>
                          <p className="text-lg font-extrabold">
                            {line.qty} × {line.name}
                            {line.size ? <span className="font-bold text-muted"> ({line.size})</span> : null}
                          </p>
                          {line.addons?.length ? <p className="text-sm">+ {line.addons.join(", ")}</p> : null}
                          {line.note ? <p className="rounded bg-accent-soft px-1.5 text-sm font-bold">“{line.note}”</p> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="flex flex-wrap justify-between gap-2 text-sm text-muted">
                      <span className="font-bold text-ink">{formatUGX(ticket.total_ugx)}</span>
                      {ticket.payment ? <span>{fill(s.paying, { method: paymentLabels[ticket.payment] })}</span> : null}
                    </p>
                    {confirming === ticket.id ? (
                      <div className="space-y-2 rounded-xl bg-danger-soft p-2">
                        <p className="font-bold">{fill(s.cancelConfirm, { number: ticket.number ?? "" })}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="danger" size="sm" onClick={() => move(ticket, "cancelled")}>
                            {s.cancelYes}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>
                            {s.cancelNo}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant={column === "ready" ? "brand" : "primary"} onClick={() => move(ticket, NEXT[column])} className="col-span-2">
                          {column === "new" ? s.start : column === "cooking" ? s.ready : s.done}
                        </Button>
                        {BACK[column] ? (
                          <Button variant="ghost" size="sm" onClick={() => move(ticket, BACK[column]!)}>
                            {s.back}
                          </Button>
                        ) : (
                          <span />
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(ticket.id)} className="text-danger">
                          {s.cancel}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
