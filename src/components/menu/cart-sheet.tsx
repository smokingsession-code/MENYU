"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/components/copy-button";
import { formatUGX } from "@/lib/money";
import { formatPhoneLocal } from "@/lib/phone";
import { buildOrderMessage, cartTotal, lineTotal, type CartLine, type OrderType } from "@/lib/order";
import { waLink } from "@/lib/whatsapp";
import { fill, track } from "./hooks";
import { ChatIcon, MinusIcon, PlusIcon } from "./icons";
import type { DinerStrings } from "./menu-app";
import { Sheet } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  setQty: (key: string, qty: number) => void;
  setNote: (key: string, note: string) => void;
  clear: () => void;
  orderTypes: OrderType[];
  tableFromQr: string | null;
  whatsapp: string | null;
  phone: string | null;
  deliveryNote: string | null;
  slug: string;
  isDemo: boolean;
  s: DinerStrings;
}

const DETAILS_KEY = "menyu:diner";

export function CartSheet(props: Props) {
  const { open, onClose, lines, s } = props;
  return lines.length === 0 ? (
    <Sheet open={open} onClose={onClose} title={s.yourOrder} closeLabel={s.close}>
      <p className="p-4 text-lg text-muted">{s.emptyOrder}</p>
    </Sheet>
  ) : (
    <CartBody {...props} total={cartTotal(lines)} />
  );
}

function CartBody({
  open,
  onClose,
  lines,
  setQty,
  setNote,
  clear,
  orderTypes,
  tableFromQr,
  whatsapp,
  phone,
  deliveryNote,
  slug,
  isDemo,
  s,
  total,
}: Props & { total: number }) {
  const [type, setType] = useState<OrderType>(orderTypes[0] ?? "dine_in");
  const [table, setTable] = useState(tableFromQr ?? "");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState(false);
  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);
  const fallbackTimer = useRef<number | undefined>(undefined);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showText) textRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [showText]);

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
    return () => window.clearTimeout(fallbackTimer.current);
  }, []);

  const message = buildOrderMessage(
    lines,
    { type, table: type === "dine_in" ? table : undefined, name, address },
    {
      newOrder: s.order.newOrder,
      table: s.order.table,
      types: s.order.types,
      total: s.order.total,
      name: s.order.name,
      address: s.order.address,
      note: s.order.note,
    },
  );

  function rememberDetails() {
    try {
      localStorage.setItem(DETAILS_KEY, JSON.stringify({ name: name.trim(), address: address.trim() }));
    } catch {
      // ignore
    }
  }

  function onSend(e: React.MouseEvent<HTMLAnchorElement>) {
    if (type === "delivery" && !address.trim()) {
      e.preventDefault();
      setAddressError(true);
      document.getElementById("cart-address")?.focus();
      return;
    }
    rememberDetails();
    track(slug, "whatsapp_order", { table: tableFromQr });
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

  async function onCopy() {
    if (await copyText(message)) {
      setCopied(true);
      track(slug, "order_copy", { table: tableFromQr });
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  const footer = (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xl font-extrabold">
        <span>{s.total}</span>
        <span>{formatUGX(total)}</span>
      </div>
      <a
        href={whatsapp && !isDemo ? waLink(whatsapp, message) : "#"}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onSend}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-lg font-extrabold text-[#0b2e17]"
      >
        <ChatIcon />
        {s.sendWhatsApp}
      </a>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={s.yourOrder} closeLabel={s.close} footer={footer}>
      <div className="space-y-5 p-4">
        <ul className="divide-y divide-line">
          {lines.map((line) => (
            <li key={line.key} className="space-y-2 py-3 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold">
                    {line.name}
                    {line.sizeName ? <span className="font-bold text-muted"> ({line.sizeName})</span> : null}
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
              onChange={(e) => {
                setAddress(e.target.value);
                setAddressError(false);
              }}
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

        {showText ? (
          <div ref={textRef} className="space-y-3 rounded-2xl border-2 border-line bg-paper p-3" role="status">
            <p className="font-extrabold">{isDemo ? s.demoOrderTitle : s.fallbackTitle}</p>
            {!isDemo ? <p className="text-sm text-muted">{fill(s.fallbackBody, { phone: whatsapp ? formatPhoneLocal(whatsapp) : phone ? formatPhoneLocal(phone) : "" })}</p> : null}
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-sans text-sm">{message}</pre>
            <button type="button" onClick={onCopy} className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-[var(--brand)] font-extrabold text-[var(--brand-text)]">
              <span aria-live="polite">{copied ? s.copied : s.copyOrder}</span>
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowText(true)} className="min-h-11 w-full font-bold text-[var(--brand-text)] underline underline-offset-2">
            {s.copyOrder}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            clear();
            setShowText(false);
          }}
          className="min-h-11 w-full font-bold text-muted"
        >
          {s.startNewOrder}
        </button>
      </div>
    </Sheet>
  );
}
