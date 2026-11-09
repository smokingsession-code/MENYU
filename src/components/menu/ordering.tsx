"use client";

import { useState } from "react";
import type { PublicLoyalty, PublicMenu } from "@/lib/menu/types";
import { formatUGX } from "@/lib/money";
import { lineTotal, type CartLine, type PaymentChoice } from "@/lib/order";
import { deviceId, fill, type LoyaltyState, type ServerOrder } from "./hooks";
import { CheckIcon, PotIcon } from "./icons";
import type { DinerStrings } from "./menu-app";

type Momo = NonNullable<PublicMenu["branch"]["momo"]>;

/** "Mobile Money or Cash" in the diner's words. */
export function paymentOptions(momo: Momo | null, acceptsCash: boolean): PaymentChoice[] {
  return [...(momo ? (["momo"] as const) : []), ...(acceptsCash ? (["cash"] as const) : [])];
}

/** "How will you pay?" in the cart. Optional: the diner may not know yet. */
export function PaymentPicker({
  options,
  value,
  onChange,
  s,
}: {
  options: PaymentChoice[];
  value: PaymentChoice | null;
  onChange: (value: PaymentChoice | null) => void;
  s: DinerStrings;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend className="mb-2 font-extrabold">{s.payHow}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(value === option ? null : option)}
            className="min-h-12 rounded-xl border-2 border-line px-2 text-sm font-extrabold aria-pressed:border-[var(--brand)] aria-pressed:bg-[var(--brand-soft)]"
          >
            {option === "momo" ? s.payMomoShort : s.payCash}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** How the diner will pay, on the bill shown to the waiter. */
function PaymentSummary({
  payment,
  options,
  momo,
  total,
  s,
}: {
  payment: PaymentChoice | null;
  options: PaymentChoice[];
  momo: Momo | null;
  total: number;
  s: DinerStrings;
}) {
  if (options.length === 0) return null;
  const word = (o: PaymentChoice) => (o === "momo" ? s.payMomoShort : s.payCash);
  const codes = momo
    ? [
        [s.mtn, momo.mtn_code, momo.mtn_name],
        [s.airtel, momo.airtel_code, momo.airtel_name],
      ].filter(([, code]) => Boolean(code))
    : [];
  return (
    <div className="space-y-2 rounded-2xl bg-paper p-3">
      <p className="font-extrabold">
        {payment
          ? fill(s.payWith, { method: word(payment) })
          : fill(s.payOptions, { methods: options.length === 2 ? fill(s.payOr, { a: word(options[0]), b: word(options[1]) }) : word(options[0]) })}
      </p>
      {payment !== "cash" && codes.length ? (
        <ul className="space-y-1">
          {codes.map(([network, code, name]) => (
            <li key={network} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm text-muted">
                {network} · {s.merchantCode}
              </span>
              <span className="font-mono text-xl font-extrabold tracking-wider">{code}</span>
              {name ? <span className="w-full text-sm">{fill(s.accountName, { name })}</span> : null}
            </li>
          ))}
          <li className="text-sm text-muted">
            {s.payTotal}: <span className="font-extrabold text-ink">{formatUGX(total)}</span>
          </li>
        </ul>
      ) : null}
      {payment === "cash" ? <p className="text-sm text-muted">{s.payCashBody}</p> : null}
    </div>
  );
}

/** The bill a diner shows the waiter: table, dishes, total and how they will pay. */
export function WaiterView({
  lines,
  table,
  typeLabel,
  name,
  payment,
  options,
  momo,
  s,
  loyalty,
}: {
  lines: CartLine[];
  table: string;
  typeLabel: string | null;
  name: string;
  payment: PaymentChoice | null;
  options: PaymentChoice[];
  momo: Momo | null;
  s: DinerStrings;
  loyalty: React.ReactNode;
}) {
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl p-4 text-center" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
        <p className="text-4xl font-extrabold">{typeLabel ?? (table ? fill(s.waiterTable, { table }) : s.waiterNoTable)}</p>
        {name.trim() ? <p className="mt-1 text-xl font-bold">{name.trim()}</p> : null}
      </div>
      <ul className="divide-y divide-line">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-xl font-extrabold">
                {line.qty} × {line.name}
                {line.sizeName ? <span className="font-bold text-muted"> ({line.sizeName})</span> : null}
              </p>
              {line.addons.length ? <p className="text-base text-muted">+ {line.addons.map((a) => a.name).join(", ")}</p> : null}
              {line.note?.trim() ? <p className="text-base font-bold">“{line.note.trim()}”</p> : null}
            </div>
            <p className="shrink-0 text-lg font-extrabold">{formatUGX(lineTotal(line))}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t-2 border-ink pt-3 text-2xl font-extrabold">
        <span>{s.total}</span>
        <span>{formatUGX(total)}</span>
      </div>
      <PaymentSummary payment={payment} options={options} momo={momo} total={total} s={s} />
      {loyalty}
    </div>
  );
}

const STEPS = ["new", "cooking", "ready"] as const;

/** A kitchen order as the diner follows it: received, cooking, ready. */
export function KitchenView({
  order,
  payment,
  s,
  loyalty,
}: {
  order: ServerOrder;
  payment?: React.ReactNode;
  s: DinerStrings;
  loyalty?: React.ReactNode;
}) {
  const current = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const finished = order.status === "done";
  return (
    <div className="space-y-4 p-4">
      {order.number ? <p className="text-center text-4xl font-extrabold">{fill(s.orderNumber, { number: order.number })}</p> : null}

      {order.status === "cancelled" ? (
        <p role="alert" className="rounded-2xl bg-danger-soft p-4 text-center text-lg font-extrabold text-danger">
          {s.kitchenCancelled}
        </p>
      ) : (
        <>
          <ol className="grid grid-cols-3 gap-2" aria-live="polite">
            {STEPS.map((step, index) => {
              const done = finished || index < current;
              const now = !finished && index === current;
              return (
                <li
                  key={step}
                  aria-current={now ? "step" : undefined}
                  className={`flex flex-col items-center gap-1 rounded-2xl border-2 p-2 text-center text-sm font-extrabold ${
                    now ? "border-[var(--brand)] bg-[var(--brand-soft)]" : done ? "border-line text-[var(--brand-text)]" : "border-line text-muted"
                  }`}
                >
                  <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border-2 border-current">
                    {done ? <CheckIcon /> : step === "cooking" ? <PotIcon /> : index + 1}
                  </span>
                  {s.kitchenSteps[step]}
                </li>
              );
            })}
          </ol>
          {order.status === "ready" ? (
            <p role="status" className="rounded-2xl p-4 text-center text-2xl font-extrabold" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
              {s.kitchenReady}
            </p>
          ) : finished ? (
            <p role="status" className="text-center text-xl font-extrabold">
              {s.kitchenDone}
            </p>
          ) : (
            <p className="text-center text-muted">{s.kitchenWatch}</p>
          )}
        </>
      )}

      <ul className="divide-y divide-line">
        {order.lines.map((line, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="font-extrabold">
                {line.qty} × {line.name}
                {line.size ? <span className="font-bold text-muted"> ({line.size})</span> : null}
              </p>
              {line.addons?.length ? <p className="text-sm text-muted">+ {line.addons.join(", ")}</p> : null}
              {line.note ? <p className="text-sm">“{line.note}”</p> : null}
            </div>
            <p className="shrink-0 font-extrabold">{formatUGX(line.total)}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t-2 border-ink pt-3 text-xl font-extrabold">
        <span>{s.total}</span>
        <span>{formatUGX(order.total)}</span>
      </div>
      {payment}
      {loyalty}
    </div>
  );
}

/** "Order 12: Cooking", fixed at the bottom of the menu while an order is on its way. */
export function KitchenPill({ order, raised, onOpen, s }: { order: ServerOrder; raised: boolean; onOpen: () => void; s: DinerStrings }) {
  const ready = order.status === "ready";
  return (
    <div className={`fixed inset-x-0 z-20 mx-auto flex max-w-2xl justify-center px-4 ${raised ? "bottom-20" : "bottom-4"}`}>
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-h-12 items-center gap-2 rounded-full px-5 font-extrabold shadow-lg ${ready ? "bg-accent text-ink" : "bg-ink text-white"}`}
      >
        <PotIcon />
        <span aria-live="polite">{fill(s.kitchenPill, { number: order.number ?? "", status: s.kitchenStatus[order.status as keyof DinerStrings["kitchenStatus"]] ?? "" })}</span>
      </button>
    </div>
  );
}

type RedeemState = "idle" | "confirm" | "sending" | "used" | "error";

/**
 * The loyalty card: stamps so far, what is left, and the reward when it is
 * ready. The diner uses the reward in front of the waiter, who sees the
 * "Reward used" screen with the time.
 */
export function LoyaltyCard({
  config,
  card,
  reward,
  slug,
  onCard,
  s,
}: {
  config: PublicLoyalty;
  card: LoyaltyState | null;
  /** The reward in the diner's language. */
  reward: string;
  slug: string;
  onCard: (card: LoyaltyState) => void;
  s: DinerStrings;
}) {
  const [redeem, setRedeem] = useState<RedeemState>("idle");
  const [usedAt, setUsedAt] = useState<string | null>(null);
  const visits = config.visits;
  const stamps = Math.min(card?.stamps ?? 0, visits);
  const ready = card?.ready ?? false;

  async function use() {
    const device = deviceId();
    if (!device) return setRedeem("error");
    setRedeem("sending");
    try {
      const res = await fetch("/api/loyalty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, device }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as { result?: string; loyalty?: LoyaltyState } | null;
      if (res.ok && json?.loyalty) {
        setUsedAt(json.loyalty.last_used_at);
        setRedeem("used");
        onCard(json.loyalty);
      } else {
        setRedeem("error");
      }
    } catch {
      setRedeem("error");
    }
  }

  if (redeem === "used") {
    const time = usedAt ? new Date(usedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" }) : "";
    return (
      <section role="status" className="rounded-2xl p-4 text-center" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
        <span aria-hidden="true" className="mx-auto flex size-14 items-center justify-center rounded-full bg-white/20">
          <CheckIcon width={32} height={32} />
        </span>
        <p className="mt-2 text-2xl font-extrabold">{s.loyaltyUsed}</p>
        <p className="text-lg font-bold">{reward}</p>
        {time ? <p className="text-base">{fill(s.loyaltyUsedAt, { time })}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label={s.loyaltyTitle} className="space-y-2 rounded-2xl border-2 p-3" style={{ borderColor: "var(--brand)", background: "var(--brand-soft)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-extrabold">★ {s.loyaltyTitle}</p>
        <p className="text-sm font-bold">{fill(s.loyaltyStamps, { stamps, visits })}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-hidden="true">
        {Array.from({ length: visits }, (_, i) => (
          <span
            key={i}
            className="flex size-7 items-center justify-center rounded-full border-2 text-xs font-extrabold"
            style={i < stamps ? { background: "var(--brand)", borderColor: "var(--brand)", color: "var(--on-brand)" } : { borderColor: "var(--brand)" }}
          >
            {i < stamps ? "★" : ""}
          </span>
        ))}
      </div>
      {ready ? (
        <>
          <p className="text-lg font-extrabold">{fill(s.loyaltyReady, { reward })}</p>
          {redeem === "confirm" || redeem === "sending" ? (
            <div className="space-y-2">
              <p className="font-bold">{s.loyaltyConfirm}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={use}
                  disabled={redeem === "sending"}
                  className="min-h-12 rounded-xl font-extrabold disabled:opacity-60"
                  style={{ background: "var(--brand)", color: "var(--on-brand)" }}
                >
                  {s.loyaltyYes}
                </button>
                <button type="button" onClick={() => setRedeem("idle")} className="min-h-12 rounded-xl border-2 border-line bg-card font-extrabold">
                  {s.loyaltyNo}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRedeem("confirm")}
              className="min-h-12 w-full rounded-xl font-extrabold"
              style={{ background: "var(--brand)", color: "var(--on-brand)" }}
            >
              {s.loyaltyUse}
            </button>
          )}
          {redeem === "error" ? (
            <p role="alert" className="text-sm font-bold text-danger">
              {s.loyaltyFailed}
            </p>
          ) : null}
        </>
      ) : card?.earned ? (
        <p className="font-extrabold">{fill(s.loyaltyEarned, { stamps, visits })}</p>
      ) : (
        <p className="text-sm">
          {card && stamps > 0 ? fill(s.loyaltyMore, { count: visits - stamps, reward }) : fill(s.loyaltyHow, { visits, reward })}
          {card?.stamped_today ? ` ${s.loyaltyToday}` : ""}
        </p>
      )}
      {!ready && config.min > 0 ? <p className="text-sm text-muted">{fill(s.loyaltyMin, { amount: formatUGX(config.min) })}</p> : null}
      <p className="text-xs text-muted">{s.loyaltyKept}</p>
    </section>
  );
}
