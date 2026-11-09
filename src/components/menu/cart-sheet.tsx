"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/components/copy-button";
import type { PublicLoyalty, PublicMenu } from "@/lib/menu/types";
import { formatUGX } from "@/lib/money";
import { formatPhoneLocal } from "@/lib/phone";
import {
  buildOrderMessage,
  cartTotal,
  lineTotal,
  orderAction,
  randomRef,
  toOrderLines,
  type CartLine,
  type OrderMode,
  type OrderType,
  type PaymentChoice,
} from "@/lib/order";
import { waLink } from "@/lib/whatsapp";
import { deviceId, fill, refreshMenu, sendOrder, track, type LoyaltyState, type OrderRequest, type OrderResponse, type ServerOrder } from "./hooks";
import { ChatIcon, MinusIcon, PlusIcon, PotIcon, ReceiptIcon } from "./icons";
import type { DinerStrings } from "./menu-app";
import { KitchenView, LoyaltyCard, PaymentPicker, WaiterView, paymentOptions } from "./ordering";
import { Sheet } from "@/components/ui/sheet";

type Momo = NonNullable<PublicMenu["branch"]["momo"]>;

interface Props {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  /** This cart's order ref (sending it again updates the same order). */
  orderRef: string;
  setQty: (key: string, qty: number) => void;
  setNote: (key: string, note: string) => void;
  /** Empties the cart and starts a new order ref. */
  clear: () => void;
  orderTypes: OrderType[];
  mode: OrderMode;
  tableFromQr: string | null;
  tableCode: string | null;
  whatsapp: string | null;
  phone: string | null;
  deliveryNote: string | null;
  slug: string;
  isDemo: boolean;
  momo: Momo | null;
  acceptsCash: boolean;
  loyalty: PublicLoyalty | null;
  loyaltyReward: string;
  card: LoyaltyState | null;
  onCard: (card: LoyaltyState) => void;
  kitchenOrder: ServerOrder | null;
  onKitchenOrder: (order: ServerOrder) => void;
  s: DinerStrings;
}

const DETAILS_KEY = "menyu:diner";

type View = "cart" | "waiter" | "kitchen";

/**
 * The order: dishes, details and the final button, which depends on how
 * the restaurant takes orders: show the waiter (a full-screen bill), send
 * on WhatsApp, or send to the kitchen screen (then follow it here).
 */
export function CartSheet(props: Props) {
  const { open, onClose, lines, s, kitchenOrder } = props;
  const [view, setView] = useState<View>("cart");
  const form = useOrderForm(props.orderTypes, props.tableFromQr);

  const showing: View = view === "kitchen" && !kitchenOrder ? "cart" : view;
  const title = showing === "waiter" ? s.waiterTitle : showing === "kitchen" ? s.kitchenSent : s.yourOrder;

  return (
    <Sheet
      open={open}
      onClose={() => {
        setView("cart");
        onClose();
      }}
      title={title}
      closeLabel={s.close}
      full={showing !== "cart"}
      footer={showing === "cart" && lines.length === 0 ? undefined : <Footer {...props} form={form} view={showing} setView={setView} />}
    >
      {showing === "kitchen" && kitchenOrder ? (
        <KitchenView order={kitchenOrder} s={s} loyalty={<Loyalty {...props} />} />
      ) : lines.length === 0 ? (
        <p className="p-4 text-lg text-muted">{s.emptyOrder}</p>
      ) : (
        <CartBody {...props} form={form} view={showing} />
      )}
    </Sheet>
  );
}

function Loyalty({ loyalty, card, loyaltyReward, slug, onCard, s }: Props) {
  if (!loyalty) return null;
  return <LoyaltyCard config={loyalty} card={card} reward={loyaltyReward} slug={slug} onCard={onCard} s={s} />;
}

interface OrderForm {
  type: OrderType;
  setType: (type: OrderType) => void;
  table: string;
  setTable: (table: string) => void;
  name: string;
  setName: (name: string) => void;
  address: string;
  setAddress: (address: string) => void;
  payment: PaymentChoice | null;
  setPayment: (payment: PaymentChoice | null) => void;
  addressError: boolean;
  setAddressError: (value: boolean) => void;
}

/** The order details, shared by the form and the final button. */
function useOrderForm(orderTypes: OrderType[], tableFromQr: string | null): OrderForm {
  const [type, setType] = useState<OrderType>(orderTypes[0] ?? "dine_in");
  const [table, setTable] = useState(tableFromQr ?? "");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [payment, setPayment] = useState<PaymentChoice | null>(null);
  const [addressError, setAddressError] = useState(false);

  // Remember name and address on this phone for next time.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DETAILS_KEY) ?? "{}") as { name?: string; address?: string };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved.name) setName(saved.name);
      if (saved.address) setAddress(saved.address);
    } catch {
      // ignore
    }
  }, []);

  // The table from the QR code is known only after the page loads.
  const tableSeen = useRef(tableFromQr);
  useEffect(() => {
    if (tableFromQr && tableSeen.current !== tableFromQr) {
      tableSeen.current = tableFromQr;
      setTable((current) => current || tableFromQr);
    }
  }, [tableFromQr]);

  const safeType = orderTypes.includes(type) ? type : (orderTypes[0] ?? "dine_in");
  return {
    type: safeType,
    setType,
    table,
    setTable,
    name,
    setName,
    address,
    setAddress: (value) => {
      setAddress(value);
      setAddressError(false);
    },
    payment,
    setPayment,
    addressError,
    setAddressError,
  };
}

function CartBody(props: Props & { form: OrderForm; view: View }) {
  const { lines, setQty, setNote, orderTypes, tableFromQr, deliveryNote, momo, acceptsCash, s, view, form } = props;
  const { type, setType, table, setTable, name, setName, address, setAddress, payment, setPayment, addressError } = form;
  const options = paymentOptions(momo, acceptsCash);

  if (view === "waiter") {
    return (
      <WaiterView
        lines={lines}
        table={table.trim()}
        typeLabel={type === "dine_in" ? null : s.types[type]}
        name={name}
        payment={payment}
        options={options}
        momo={momo}
        s={s}
        loyalty={<Loyalty {...props} />}
      />
    );
  }

  return (
    <div className="space-y-5 p-4">
      <ul className="divide-y divide-line">
        {lines.map((line) => (
          <li key={line.key} className="space-y-2 py-3 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold">
                  {line.name}
                  {line.sizeName ? <span className="font-bold text-muted"> ({line.sizeName})</span> : null}
                  {line.percentOff ? <span className="ml-1 rounded-full bg-accent px-1.5 text-xs font-extrabold text-ink">-{line.percentOff}%</span> : null}
                </p>
                {line.addons.length ? <p className="text-sm text-muted">+ {line.addons.map((a) => a.name).join(", ")}</p> : null}
              </div>
              <p className="shrink-0 font-extrabold">{formatUGX(lineTotal(line))}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                aria-label={s.note}
                value={line.note ?? ""}
                maxLength={120}
                onChange={(e) => setNote(line.key, e.target.value)}
                placeholder={s.notePlaceholder}
                className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-line px-3 text-base focus:border-[var(--brand)] focus:outline-none"
              />
              <button type="button" onClick={() => setQty(line.key, line.qty - 1)} aria-label={line.qty === 1 ? s.remove : s.less} className="inline-flex size-11 items-center justify-center rounded-full border-2 border-line">
                <MinusIcon />
              </button>
              <output className="w-7 text-center text-lg font-extrabold">{line.qty}</output>
              <button type="button" onClick={() => setQty(line.key, line.qty + 1)} aria-label={s.more} className="inline-flex size-11 items-center justify-center rounded-full border-2 border-line">
                <PlusIcon />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {orderTypes.length > 1 ? (
        <fieldset>
          <legend className="mb-2 font-extrabold">{s.orderType}</legend>
          <div className="grid grid-cols-3 gap-2">
            {orderTypes.map((t) => (
              <label key={t} className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-line px-2 text-center text-sm font-extrabold has-[:checked]:border-[var(--brand)] has-[:checked]:bg-[var(--brand-soft)]">
                <input type="radio" name="order-type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
                {s.types[t]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {type === "dine_in" ? (
        <div>
          <label htmlFor="cart-table" className="mb-1.5 block font-extrabold">
            {s.table}
          </label>
          <input
            id="cart-table"
            value={table}
            maxLength={40}
            onChange={(e) => setTable(e.target.value)}
            placeholder={s.tablePlaceholder}
            className="block min-h-12 w-full rounded-xl border-2 border-line px-3 text-base focus:border-[var(--brand)] focus:outline-none"
          />
          {tableFromQr ? <p className="mt-1 text-sm text-muted">{s.tableHint}</p> : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="cart-name" className="mb-1.5 block font-extrabold">
          {s.yourName}
        </label>
        <input
          id="cart-name"
          value={name}
          maxLength={80}
          autoComplete="given-name"
          onChange={(e) => setName(e.target.value)}
          className="block min-h-12 w-full rounded-xl border-2 border-line px-3 text-base focus:border-[var(--brand)] focus:outline-none"
        />
      </div>

      {type === "delivery" ? (
        <div>
          <label htmlFor="cart-address" className="mb-1.5 block font-extrabold">
            {s.address}
          </label>
          <textarea
            id="cart-address"
            value={address}
            maxLength={300}
            rows={2}
            autoComplete="street-address"
            onChange={(e) => setAddress(e.target.value)}
            placeholder={s.addressPlaceholder}
            aria-invalid={addressError || undefined}
            aria-describedby={addressError ? "cart-address-error" : undefined}
            className="block w-full rounded-xl border-2 border-line px-3 py-2 text-base focus:border-[var(--brand)] focus:outline-none aria-invalid:border-danger"
          />
          {addressError ? (
            <p id="cart-address-error" role="alert" className="mt-1 text-sm font-bold text-danger">
              {s.addressRequired}
            </p>
          ) : null}
          {deliveryNote ? <p className="mt-1 text-sm text-muted">{deliveryNote}</p> : null}
        </div>
      ) : null}

      <PaymentPicker options={options} value={payment} onChange={setPayment} s={s} />
      <Loyalty {...props} />
    </div>
  );
}

function Footer(props: Props & { form: OrderForm; view: View; setView: (v: View) => void }) {
  const { lines, orderRef, clear, mode, tableFromQr, tableCode, whatsapp, phone, slug, isDemo, loyalty, onCard, onKitchenOrder, onClose, s, view, setView, form } = props;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ text: string; refresh?: boolean } | null>(null);
  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);
  const fallbackTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(fallbackTimer.current), []);

  const { type, table, name, address, payment } = form;
  const action = orderAction(mode, type);
  const total = cartTotal(lines);

  if (view === "kitchen") {
    return (
      <button type="button" onClick={onClose} className="min-h-14 w-full rounded-2xl text-lg font-extrabold" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
        {s.backToMenu}
      </button>
    );
  }
  if (view === "waiter") {
    return (
      <div className="grid grid-cols-1 gap-2">
        <button type="button" onClick={onClose} className="min-h-14 w-full rounded-2xl text-lg font-extrabold" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
          {s.backToMenu}
        </button>
        <button
          type="button"
          onClick={() => {
            clear();
            onClose();
          }}
          className="min-h-11 w-full font-bold text-muted"
        >
          {s.startNewOrder}
        </button>
      </div>
    );
  }

  const message = buildOrderMessage(
    lines,
    { type, table: type === "dine_in" ? table : undefined, name, address, payment },
    {
      newOrder: s.order.newOrder,
      table: s.order.table,
      types: s.order.types,
      total: s.order.total,
      name: s.order.name,
      address: s.order.address,
      note: s.order.note,
      payment: s.order.payment,
      payments: s.order.payments,
    },
  );

  function request(m: OrderMode): OrderRequest {
    return {
      slug,
      ref: orderRef || randomRef(),
      mode: m,
      type,
      table: type === "dine_in" ? tableCode : null,
      tableLabel: type === "dine_in" ? table.trim() : undefined,
      name: name.trim(),
      address: type === "delivery" ? address.trim() : undefined,
      payment,
      lines: toOrderLines(lines),
      device: loyalty ? deviceId() : null,
    };
  }

  function ready(): boolean {
    if (type === "delivery" && !address.trim()) {
      form.setAddressError(true);
      document.getElementById("cart-address")?.focus();
      return false;
    }
    try {
      localStorage.setItem(DETAILS_KEY, JSON.stringify({ name: name.trim(), address: address.trim() }));
    } catch {
      // ignore
    }
    return true;
  }

  function record(m: OrderMode) {
    if (isDemo) return;
    void sendOrder(request(m)).then((r) => {
      if (r.loyalty) onCard(r.loyalty);
    });
  }

  function onWhatsApp(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!ready()) return e.preventDefault();
    track(slug, "whatsapp_order", { table: tableFromQr });
    record("whatsapp");
    if (isDemo || !whatsapp) {
      e.preventDefault();
      setShowText(true);
      return;
    }
    // If the page is still on screen a moment later, WhatsApp did not open.
    window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = window.setTimeout(() => {
      if (document.visibilityState === "visible") setShowText(true);
    }, 2500);
  }

  function onWaiter() {
    if (!ready()) return;
    record("waiter");
    setView("waiter");
  }

  async function onKitchen() {
    if (!ready() || sending) return;
    setProblem(null);
    setSending(true);
    const r: OrderResponse = await sendOrder(request("kitchen"));
    setSending(false);
    if (r.result === "ok" && r.order) {
      if (r.loyalty) onCard(r.loyalty);
      onKitchenOrder(r.order);
      clear();
      setView("kitchen");
      return;
    }
    setProblem(
      r.result === "sold_out"
        ? { text: fill(s.orderSoldOut, { items: (r.items ?? []).join(", ") }) }
        : r.result === "changed" || r.result === "mode_changed"
          ? { text: s.orderChanged, refresh: true }
          : r.result === "too_many"
            ? { text: s.orderTooMany }
            : { text: s.orderFailed },
    );
  }

  async function onCopy() {
    if (await copyText(message)) {
      setCopied(true);
      track(slug, "order_copy", { table: tableFromQr });
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xl font-extrabold">
        <span>{s.total}</span>
        <span>{formatUGX(total)}</span>
      </div>
      {problem ? (
        <div role="alert" className="space-y-2 rounded-xl bg-danger-soft p-3 font-bold text-danger">
          <p>{problem.text}</p>
          {problem.refresh ? (
            <button type="button" onClick={() => refreshMenu()} className="min-h-11 rounded-xl bg-card px-4 font-extrabold text-ink">
              {s.refresh}
            </button>
          ) : null}
        </div>
      ) : null}
      {action === "whatsapp" ? (
        <a
          href={whatsapp && !isDemo ? waLink(whatsapp, message) : "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onWhatsApp}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-lg font-extrabold text-[#0b2e17]"
        >
          <ChatIcon />
          {s.sendWhatsApp}
        </a>
      ) : action === "waiter" ? (
        <button
          type="button"
          onClick={onWaiter}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-lg font-extrabold"
          style={{ background: "var(--brand)", color: "var(--on-brand)" }}
        >
          <ReceiptIcon />
          {s.showWaiter}
        </button>
      ) : (
        <button
          type="button"
          onClick={onKitchen}
          disabled={sending}
          aria-busy={sending || undefined}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-lg font-extrabold disabled:opacity-70"
          style={{ background: "var(--brand)", color: "var(--on-brand)" }}
        >
          <PotIcon />
          {sending ? s.sendingOrder : s.sendKitchen}
        </button>
      )}
      {action === "whatsapp" ? (
        showText ? (
          <div className="space-y-3 rounded-2xl border-2 border-line bg-paper p-3" role="status">
            <p className="font-extrabold">{isDemo ? s.demoOrderTitle : s.fallbackTitle}</p>
            {!isDemo ? <p className="text-sm text-muted">{fill(s.fallbackBody, { phone: whatsapp ? formatPhoneLocal(whatsapp) : phone ? formatPhoneLocal(phone) : "" })}</p> : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-sans text-sm">{message}</pre>
            <button type="button" onClick={onCopy} className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-[var(--brand)] font-extrabold text-[var(--brand-text)]">
              <span aria-live="polite">{copied ? s.copied : s.copyOrder}</span>
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowText(true)} className="min-h-11 w-full font-bold text-[var(--brand-text)] underline underline-offset-2">
            {s.copyOrder}
          </button>
        )
      ) : null}
      <button
        type="button"
        onClick={() => {
          clear();
          setShowText(false);
          setProblem(null);
          onClose();
        }}
        className="min-h-11 w-full font-bold text-muted"
      >
        {s.startNewOrder}
      </button>
    </div>
  );
}
