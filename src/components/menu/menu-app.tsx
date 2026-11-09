"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type enMessages from "../../../messages/en.json";
import { readableBrand, textOn, tint } from "@/lib/color";
import { applyDealCss, dealIsOn, dealPrice, dealsByItem, dealsScript } from "@/lib/deals";
import { DAY_KEYS, formatClock, openStatus, type OpenStatus } from "@/lib/hours";
import { imageSrcSet, imageUrl, pickWidth } from "@/lib/images/shared";
import { formatUGX } from "@/lib/money";
import { buildTableMessage, cartCount, cartTotal, lineKey, orderTypesFor, type CartLine } from "@/lib/order";
import { matchesQuery } from "@/lib/text";
import { waLink } from "@/lib/whatsapp";
import { startingPrice, type PublicDeal, type PublicItem, type PublicMenu } from "@/lib/menu/types";
import { Sheet } from "@/components/ui/sheet";
import { CartSheet } from "./cart-sheet";
import { DealsBanner, FeedbackSheet, PaySheet, SpecialsBanner } from "./extras";
import {
  fill,
  refreshMenu,
  shouldAutoRefresh,
  track,
  useCart,
  useKitchenOrder,
  useLanguage,
  useLiveMenu,
  useServiceWorker,
  useTableCode,
  type LiveState,
  type LoyaltyState,
} from "./hooks";
import { KitchenPill, KitchenView, LoyaltyCard } from "./ordering";
import { BagIcon, BellIcon, ChatIcon, CloseIcon, PhoneIcon, PinIcon, PlusIcon, ReceiptIcon, SearchIcon, WalletIcon } from "./icons";
import { ItemSheet } from "./item-sheet";
import { TagList } from "./tags";

export type DinerStrings = (typeof enMessages)["diner"];

const TABLE_ACTIONS_ID = "menu-table-actions";
/** Shows the waiter buttons straight away when the link names a known table. */
const TABLE_ACTIONS_SCRIPT = `(function(){var el=document.getElementById("${TABLE_ACTIONS_ID}");if(!el)return;var t=new URLSearchParams(location.search).get("t");var codes=JSON.parse(el.getAttribute("data-tables")||"[]");if(t&&codes.indexOf(t)>=0)el.hidden=false;})();`;
export type Translate = (en: string, lg: string | null | undefined) => string;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === "object") out[k] = merge(out[k] as object, v as object);
    else if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out as T;
}

export function MenuApp({
  menu,
  strings,
  lgStrings,
  brandName,
  homeUrl,
}: {
  menu: PublicMenu;
  strings: DinerStrings;
  /** Luganda UI text filled in so far (empty strings fall back to English). */
  lgStrings?: DeepPartial<DinerStrings>;
  brandName: string;
  homeUrl: string;
}) {
  const { restaurant, branch, features } = menu;
  const slug = branch.slug;
  const [lang, setLang] = useLanguage(menu.has_luganda);
  const s = useMemo(() => (lang === "lg" ? merge(strings, lgStrings) : strings), [lang, strings, lgStrings]);
  const tr: Translate = (en, lg) => (lang === "lg" && lg?.trim() ? lg : en);

  // The branch's mode already falls back when WhatsApp or the kitchen
  // screen is not available, so any paid menu can take orders.
  const canOrder = features.whatsapp_ordering;
  const mode = branch.order_mode ?? (branch.whatsapp ? "whatsapp" : "waiter");
  const { code: tableCode, ready } = useTableCode();
  const tableLabel = tableCode ? (menu.tables[tableCode] ?? null) : null;

  // "Sell it today" deals. Prices for both cases are in the page; a style
  // sheet shows the right one (see lib/deals), and adding to the order
  // checks the clock at that moment.
  const deals = useMemo(() => (features.specials ? (menu.deals ?? []) : []), [features.specials, menu.deals]);
  const dealMap = useMemo(() => dealsByItem(deals), [deals]);
  useEffect(() => {
    if (deals.length === 0) return;
    const update = () => applyDealCss(deals, Date.now());
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, [deals]);
  const liveDeal = (itemId: string): PublicDeal | null => {
    const deal = dealMap.get(itemId);
    return deal && dealIsOn(deal, Date.now()) ? deal : null;
  };

  const loyalty = features.loyalty && features.whatsapp_ordering ? (menu.loyalty ?? null) : null;
  const [card, setCard] = useState<LoyaltyState | null>(null);
  const [kitchenOrder, setKitchenOrder] = useKitchenOrder(slug);
  const [kitchenOpen, setKitchenOpen] = useState(false);

  const cart = useCart(slug);
  const [soldOut, setSoldOut] = useState<Set<string>>(
    () => new Set(menu.categories.flatMap((c) => c.items.filter((i) => i.sold_out).map((i) => i.id))),
  );
  const [stale, setStale] = useState(false);
  // Sold-out changes apply in place. Other changes need the new page: fetch
  // it straight away if the diner has not started an order, else offer it.
  const busy = useRef(false);
  useLiveMenu(
    slug,
    tableCode,
    ready,
    (live: LiveState) => {
      setSoldOut(new Set(live.sold_out));
      if (live.loyalty) setCard(live.loyalty);
      if (live.version <= menu.version) return;
      if (!busy.current && shouldAutoRefresh(slug, live.version)) refreshMenu();
      else setStale(true);
    },
    Boolean(loyalty),
  );
  useServiceWorker();

  const [status, setStatus] = useState<OpenStatus | null>(null);
  useEffect(() => {
    const update = () => setStatus(openStatus(branch.opening_hours, new Date()));
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [branch.opening_hours]);

  const [query, setQuery] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [demoNote, setDemoNote] = useState(false);

  const allItems = useMemo(() => menu.categories.flatMap((c) => c.items), [menu.categories]);
  const itemsById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const openItem = allItems.find((i) => i.id === openItemId) ?? null;

  const sections = useMemo(() => {
    if (!query.trim()) return menu.categories;
    return menu.categories
      .map((c) => ({
        ...c,
        items: c.items.filter((i) =>
          matchesQuery([i.name, i.name_lg, i.description, i.description_lg, c.name, c.name_lg, i.tags.join(" ")].join(" "), query),
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu.categories, query]);
  const resultCount = sections.reduce((n, c) => n + c.items.length, 0);

  const orderTypes = useMemo(() => orderTypesFor(branch), [branch]);

  const brand = restaurant.brand_color || "#1E5B3A";
  const style = {
    "--brand": brand,
    "--on-brand": textOn(brand),
    "--brand-text": readableBrand(brand),
    "--brand-soft": tint(brand, 0.88),
  } as CSSProperties;

  function openDetails(item: PublicItem) {
    setOpenItemId(item.id);
    track(slug, "item_view", { table: tableCode, itemId: item.id });
  }

  function quickAdd(item: PublicItem) {
    const deal = liveDeal(item.id);
    const line: CartLine = {
      key: lineKey(item.id, undefined, [], undefined) + (deal ? `|-${deal.percent}` : ""),
      itemId: item.id,
      name: tr(item.name, item.name_lg),
      addons: [],
      unitPrice: deal ? dealPrice(item.price ?? 0, deal.percent) : (item.price ?? 0),
      qty: 1,
      ...(deal ? { percentOff: deal.percent } : {}),
    };
    cart.add(line);
    setAnnounce(fill(s.addNamed, { name: line.name }) + " ✓");
  }

  function addFromSheet(line: CartLine) {
    cart.add(line);
    setAnnounce(fill(s.addNamed, { name: line.name }) + " ✓");
  }

  const count = cartCount(cart.lines);
  const total = cartTotal(cart.lines);
  useEffect(() => {
    busy.current = count > 0 || openItemId !== null || cartOpen || payOpen || feedbackOpen || kitchenOpen;
  }, [count, openItemId, cartOpen, payOpen, feedbackOpen, kitchenOpen]);
  const hello = fill(s.helloMessage, { restaurant: restaurant.name });
  // "Call the waiter" and "Bring the bill" need to know the table.
  const waiterPossible = features.waiter_call && Boolean(branch.whatsapp) && Object.keys(menu.tables).length > 0;
  const canCallWaiter = waiterPossible && Boolean(tableLabel);
  const momo = features.momo_pay ? branch.momo : null;
  const tableAction = (type: "waiter_call" | "bill_request") => ({
    href: branch.whatsapp && tableLabel ? waLink(branch.whatsapp, buildTableMessage(type === "waiter_call" ? s.waiterMessage : s.billMessage, tableLabel ?? undefined, "?")) : undefined,
    onClick: () => track(slug, type, { table: tableCode }),
  });

  const reward = loyalty ? tr(loyalty.reward, loyalty.reward_lg) : "";
  const loyaltyCard = loyalty ? <LoyaltyCard config={loyalty} card={card} reward={reward} slug={slug} onCard={setCard} s={s} /> : null;
  const showPill = Boolean(kitchenOrder && kitchenOrder.status !== "done" && !cartOpen && !kitchenOpen);

  return (
    <div style={style} className="mx-auto flex min-h-screen w-full max-w-2xl flex-col bg-paper">
      {/* Before anything is drawn: which deals are still on (see lib/deals). */}
      {deals.length ? <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: dealsScript(deals) }} /> : null}
      {restaurant.is_demo ? (
        <p className="bg-ink px-4 py-2 text-center text-sm font-bold text-white">{s.demoBanner}</p>
      ) : null}

      <header className="bg-card pb-4">
        {restaurant.cover ? (
          <img
            src={imageUrl(restaurant.cover, pickWidth(restaurant.cover, 360))}
            srcSet={imageSrcSet(restaurant.cover)}
            sizes="(min-width: 672px) 672px, 100vw"
            width={restaurant.cover.w}
            height={restaurant.cover.h}
            alt=""
            fetchPriority="high"
            decoding="async"
            className="aspect-[16/7] w-full object-cover"
            style={{ backgroundColor: restaurant.cover.color }}
          />
        ) : (
          <div className="h-20" style={{ background: "var(--brand)" }} />
        )}
        <div className="px-4">
          <div className="-mt-9 flex items-end gap-3">
            {restaurant.logo ? (
              <img
                src={imageUrl(restaurant.logo, pickWidth(restaurant.logo, 72))}
                srcSet={imageSrcSet(restaurant.logo)}
                sizes="72px"
                width={72}
                height={72}
                alt=""
                className="size-[72px] shrink-0 rounded-full border-4 border-card bg-card object-cover"
                style={{ backgroundColor: restaurant.logo.color }}
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-[72px] shrink-0 items-center justify-center rounded-full border-4 border-card text-3xl font-extrabold"
                style={{ background: "var(--brand)", color: "var(--on-brand)" }}
              >
                {restaurant.name.slice(0, 1)}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-[1.7rem] font-extrabold leading-tight">{restaurant.name}</h1>
          <p className="text-base text-muted">{[branch.area, ...restaurant.cuisines.slice(0, 2)].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 min-h-6 text-base" aria-live="polite">
            <OpenLine status={status} s={s} />
          </p>
          {tr(restaurant.description ?? "", restaurant.description_lg) ? (
            <p className="mt-2 text-base text-muted">{tr(restaurant.description ?? "", restaurant.description_lg)}</p>
          ) : null}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <ContactButton
              href={branch.phone ? `tel:+${branch.phone}` : undefined}
              demo={restaurant.is_demo}
              onDemo={() => setDemoNote(true)}
              label={s.call}
              icon={<PhoneIcon />}
            />
            <ContactButton
              href={branch.whatsapp ? waLink(branch.whatsapp, hello) : undefined}
              demo={restaurant.is_demo}
              onDemo={() => setDemoNote(true)}
              label={s.whatsapp}
              icon={<ChatIcon />}
              external
            />
            <ContactButton
              href={mapsUrl(menu)}
              label={s.map}
              icon={<PinIcon />}
              external
            />
          </div>
          {waiterPossible ? (
            <>
              {/* Shown only for a known table. The table is in the link, which
                  React reads after the page loads; the inline script shows the
                  row before it is drawn, so the menu does not jump. */}
              <div
                id={TABLE_ACTIONS_ID}
                hidden={!canCallWaiter}
                suppressHydrationWarning
                data-tables={JSON.stringify(Object.keys(menu.tables))}
                className="mt-2 grid grid-cols-2 gap-2"
              >
                <ContactButton
                  {...tableAction("waiter_call")}
                  demo={restaurant.is_demo}
                  onDemo={() => setDemoNote(true)}
                  label={s.waiter}
                  icon={<BellIcon />}
                  external
                />
                <ContactButton
                  {...tableAction("bill_request")}
                  demo={restaurant.is_demo}
                  onDemo={() => setDemoNote(true)}
                  label={s.bill}
                  icon={<ReceiptIcon />}
                  external
                />
              </div>
              <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: TABLE_ACTIONS_SCRIPT }} />
            </>
          ) : null}
          {momo ? (
            <button
              type="button"
              onClick={() => {
                setPayOpen(true);
                track(slug, "momo_view", { table: tableCode });
              }}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-line bg-card font-bold"
            >
              <WalletIcon />
              {s.payMomo}
            </button>
          ) : null}
          {demoNote ? <p className="mt-2 text-sm font-bold text-muted">{s.demoNoContact}</p> : null}

          {menu.has_luganda ? (
            <div className="mt-3 flex items-center gap-2" role="group" aria-label={s.language}>
              {(["en", "lg"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                  className="min-h-11 rounded-full border-2 border-line px-4 font-bold aria-pressed:border-[var(--brand)] aria-pressed:bg-[var(--brand-soft)]"
                >
                  {l === "en" ? "English" : "Luganda"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {deals.length ? (
        <DealsBanner
          deals={deals}
          items={itemsById}
          soldOut={soldOut}
          canOrder={canOrder}
          onAdd={quickAdd}
          onOpen={openDetails}
          s={s}
          tr={tr}
        />
      ) : null}

      {features.specials && menu.specials.length ? (
        <SpecialsBanner specials={menu.specials} canOrder={canOrder} onAdd={addFromSheet} s={s} tr={tr} />
      ) : null}

      <StickyNav
        sections={sections}
        query={query}
        setQuery={setQuery}
        tr={tr}
        s={s}
      />

      <main className={`flex-1 px-4 pt-2 ${count > 0 ? "pb-28" : "pb-10"}`}>
        {menu.categories.length === 0 ? <p className="py-10 text-center text-lg text-muted">{s.emptyMenu}</p> : null}
        {query.trim() ? (
          <p className="py-2 text-sm text-muted" aria-live="polite">
            {resultCount === 0 ? fill(s.noResults, { query: query.trim() }) : fill(s.resultCount, { count: resultCount })}
          </p>
        ) : null}
        {sections.map((category) => (
          <section key={category.id} id={`c-${category.id}`} aria-labelledby={`h-${category.id}`} className="scroll-mt-32 pt-4">
            <h2 id={`h-${category.id}`} className="mb-2 text-xl font-extrabold">
              {tr(category.name, category.name_lg)}
            </h2>
            <ul className="space-y-2">
              {category.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  deal={dealMap.get(item.id)}
                  soldOut={soldOut.has(item.id)}
                  canOrder={canOrder}
                  onOpen={() => openDetails(item)}
                  onQuickAdd={() => quickAdd(item)}
                  s={s}
                  tr={tr}
                />
              ))}
            </ul>
          </section>
        ))}

        {features.feedback ? (
          <section className="mt-10 rounded-2xl border-2 border-line bg-card p-4 text-center">
            <p className="text-base">{s.feedbackPrompt}</p>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="mt-3 min-h-12 rounded-xl px-5 font-extrabold"
              style={{ background: "var(--brand)", color: "var(--on-brand)" }}
            >
              ★ {s.feedbackCta}
            </button>
          </section>
        ) : null}

        {!features.hide_footer ? (
          <footer className="mt-10 text-center">
            <a href={`${homeUrl}/?ref=menu`} className="inline-flex min-h-11 items-center font-bold text-muted underline underline-offset-2">
              {fill(s.madeWith, { brand: brandName })}
            </a>
          </footer>
        ) : null}
      </main>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {stale ? (
        <div className={`fixed inset-x-0 z-30 mx-auto flex max-w-2xl justify-center px-4 ${count > 0 ? "bottom-24" : "bottom-4"}`}>
          <div className="flex w-full items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-lg">
            <span className="font-bold">{s.menuChanged}</span>
            <button type="button" onClick={() => refreshMenu()} className="min-h-11 rounded-xl bg-white px-4 font-extrabold text-ink">
              {s.refresh}
            </button>
          </div>
        </div>
      ) : null}

      {canOrder && count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-lg font-extrabold shadow-lg"
            style={{ background: "var(--brand)", color: "var(--on-brand)" }}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="relative shrink-0">
                <BagIcon />
                <span
                  aria-hidden="true"
                  className="absolute -right-2.5 -top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1 text-xs font-extrabold text-ink"
                >
                  {count}
                </span>
              </span>
              <span className="truncate">{s.viewOrder}</span>
            </span>
            {/* The count is a badge on screen; screen readers hear it in words. */}
            <span className="shrink-0 whitespace-nowrap">
              <span className="sr-only">{count === 1 ? s.oneItem : fill(s.itemsCount, { count })} · </span>
              {formatUGX(total)}
            </span>
          </button>
        </div>
      ) : null}

      {showPill && kitchenOrder ? (
        <KitchenPill order={kitchenOrder} raised={canOrder && count > 0} onOpen={() => setKitchenOpen(true)} s={s} />
      ) : null}
      {kitchenOrder ? (
        <Sheet
          open={kitchenOpen}
          onClose={() => {
            setKitchenOpen(false);
            // A cancelled order has been seen: forget it.
            if (kitchenOrder.status === "cancelled") setKitchenOrder(null);
          }}
          title={s.kitchenSent}
          closeLabel={s.close}
          full
          footer={
            <button
              type="button"
              onClick={() => setKitchenOpen(false)}
              className="min-h-14 w-full rounded-2xl text-lg font-extrabold"
              style={{ background: "var(--brand)", color: "var(--on-brand)" }}
            >
              {s.backToMenu}
            </button>
          }
        >
          <KitchenView order={kitchenOrder} s={s} loyalty={loyaltyCard} />
        </Sheet>
      ) : null}

      {momo ? <PaySheet open={payOpen} onClose={() => setPayOpen(false)} momo={momo} acceptsCash={branch.accepts_cash ?? true} total={total} s={s} /> : null}
      {features.feedback ? (
        <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} slug={slug} table={tableCode} s={s} />
      ) : null}
      <ItemSheet
        item={openItem}
        deal={openItem ? dealMap.get(openItem.id) : undefined}
        open={openItemId !== null}
        onClose={() => setOpenItemId(null)}
        onAdd={addFromSheet}
        canOrder={canOrder}
        soldOut={openItem ? soldOut.has(openItem.id) : false}
        s={s}
        tr={tr}
      />
      {canOrder ? (
        <CartSheet
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          lines={cart.lines}
          orderRef={cart.ref}
          setQty={cart.setQty}
          setNote={cart.setNote}
          clear={cart.clear}
          orderTypes={orderTypes}
          mode={mode}
          tableFromQr={tableLabel}
          tableCode={tableLabel ? tableCode : null}
          whatsapp={branch.whatsapp}
          phone={branch.phone}
          deliveryNote={branch.delivery_note}
          slug={slug}
          isDemo={restaurant.is_demo}
          momo={momo}
          acceptsCash={branch.accepts_cash ?? true}
          loyalty={loyalty}
          loyaltyReward={reward}
          card={card}
          onCard={setCard}
          kitchenOrder={kitchenOrder}
          onKitchenOrder={setKitchenOrder}
          s={s}
        />
      ) : null}
    </div>
  );
}

function mapsUrl(menu: PublicMenu): string | undefined {
  const { lat, lng, address } = menu.branch;
  if (lat !== null && lng !== null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${menu.restaurant.name}, ${address}`)}`;
  return undefined;
}

function OpenLine({ status, s }: { status: OpenStatus | null; s: DinerStrings }) {
  if (!status || !status.known) return null;
  if (status.open) {
    return (
      <>
        <span className="font-extrabold text-brand">{s.openNow}</span>
        <span className="text-muted"> · {fill(s.untilTime, { time: formatClock(status.closesAt) })}</span>
      </>
    );
  }
  const time = formatClock(status.opensAt);
  const when = status.inMinutes < 24 * 60 ? fill(s.opensAt, { time }) : fill(s.opensDayAt, { day: s.days[DAY_KEYS[status.opensDay]], time });
  return (
    <>
      <span className="font-extrabold text-danger">{s.closed}</span>
      <span className="text-muted"> · {when}</span>
    </>
  );
}

function ContactButton({
  href,
  label,
  icon,
  external,
  demo,
  onDemo,
  onClick,
}: {
  href: string | undefined;
  label: string;
  icon: React.ReactNode;
  external?: boolean;
  demo?: boolean;
  onDemo?: () => void;
  /** Runs when the link really opens (not on the demo menu). */
  onClick?: () => void;
}) {
  const className =
    "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-line bg-card px-1 text-sm font-extrabold text-[var(--brand-text)]";
  if (!href) return <span className={`${className} opacity-40`} aria-hidden="true">{icon}{label}</span>;
  return (
    <a
      href={demo ? "#" : href}
      onClick={(e) => {
        if (demo) {
          e.preventDefault();
          onDemo?.();
        } else {
          onClick?.();
        }
      }}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={className}
    >
      {icon}
      {label}
    </a>
  );
}

function StickyNav({
  sections,
  query,
  setQuery,
  tr,
  s,
}: {
  sections: PublicMenu["categories"];
  query: string;
  setQuery: (q: string) => void;
  tr: Translate;
  s: DinerStrings;
}) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Highlight the section being read.
  useEffect(() => {
    if (query.trim()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.slice(2));
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    for (const section of sections) {
      const el = document.getElementById(`c-${section.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections, query]);

  // Keep the active tab visible in the scrolling strip.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (strip && tab) strip.scrollTo({ left: tab.offsetLeft - 16, behavior: "smooth" });
  }, [active]);

  return (
    <nav aria-label={s.sections} className="sticky top-0 z-10 border-b border-line bg-card/95 px-4 pt-3 pb-2 shadow-sm backdrop-blur">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <label htmlFor="menu-search" className="sr-only">
          {s.searchLabel}
        </label>
        <input
          id="menu-search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={s.searchPlaceholder}
          className="block min-h-12 w-full rounded-xl border-2 border-line bg-paper pr-12 pl-10 text-base focus:border-[var(--brand)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={s.clearSearch}
            className="absolute top-1/2 right-1 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted"
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>
      {!query.trim() && sections.length > 1 ? (
        <div ref={stripRef} className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {sections.map((c) => (
            <button
              key={c.id}
              type="button"
              data-tab={c.id}
              aria-current={active === c.id ? "true" : undefined}
              onClick={() => {
                setActive(c.id);
                document.getElementById(`c-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="min-h-11 shrink-0 rounded-full border-2 border-line px-4 font-bold whitespace-nowrap aria-[current]:border-[var(--brand)] aria-[current]:bg-[var(--brand)] aria-[current]:text-[var(--on-brand)]"
            >
              {tr(c.name, c.name_lg)}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function ItemCard({
  item,
  deal,
  soldOut,
  canOrder,
  onOpen,
  onQuickAdd,
  s,
  tr,
}: {
  item: PublicItem;
  /** Shown only while it is on, by the deals style sheet. */
  deal: PublicDeal | undefined;
  soldOut: boolean;
  canOrder: boolean;
  onOpen: () => void;
  onQuickAdd: () => void;
  s: DinerStrings;
  tr: Translate;
}) {
  const name = tr(item.name, item.name_lg);
  const description = tr(item.description ?? "", item.description_lg);
  const { price, from } = startingPrice(item);
  const simple = item.options.length === 0 && item.price !== null;
  const quickAdd = canOrder && simple && !soldOut;
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full gap-3 rounded-2xl border border-line bg-card p-3 text-left ${soldOut ? "opacity-60" : ""}`}
      >
        <span className={`min-w-0 flex-1 ${quickAdd ? "pb-1 pr-12" : ""}`}>
          <span className="block text-lg leading-snug font-extrabold">{name}</span>
          {description ? <span className="mt-0.5 line-clamp-2 block text-[0.95rem] text-muted">{description}</span> : null}
          {item.tags.length ? (
            <span className="mt-1.5 block">
              <TagList tags={item.tags} s={s} />
            </span>
          ) : null}
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            {price !== null && deal ? (
              <>
                <span className="dl-off text-base font-extrabold" data-dl={item.id}>
                  {from ? fill(s.fromPrice, { price: formatUGX(price) }) : formatUGX(price)}
                </span>
                <span className="dl-on" data-dl={item.id}>
                  <s className="text-sm text-muted">{formatUGX(price)}</s>{" "}
                  <span className="text-base font-extrabold">
                    {from ? fill(s.fromPrice, { price: formatUGX(dealPrice(price, deal.percent)) }) : formatUGX(dealPrice(price, deal.percent))}
                  </span>{" "}
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-extrabold text-ink">{fill(s.dealOff, { percent: deal.percent })}</span>
                </span>
              </>
            ) : price !== null ? (
              <span className="text-base font-extrabold">{from ? fill(s.fromPrice, { price: formatUGX(price) }) : formatUGX(price)}</span>
            ) : null}
            {soldOut ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-sm font-extrabold text-danger">{s.soldOut}</span> : null}
          </span>
        </span>
        {item.photo ? (
          <img
            src={imageUrl(item.photo, pickWidth(item.photo, 96))}
            srcSet={imageSrcSet(item.photo)}
            sizes="96px"
            width={96}
            height={96}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-24 shrink-0 rounded-xl object-cover"
            style={{ backgroundColor: item.photo.color }}
          />
        ) : null}
      </button>
      {quickAdd ? (
        <button
          type="button"
          onClick={onQuickAdd}
          aria-label={fill(s.addNamed, { name })}
          className={`absolute bottom-3 inline-flex size-11 items-center justify-center rounded-full shadow ${item.photo ? "right-[7.25rem]" : "right-3"}`}
          style={{ background: "var(--brand)", color: "var(--on-brand)" }}
        >
          <PlusIcon />
        </button>
      ) : null}
    </li>
  );
}
