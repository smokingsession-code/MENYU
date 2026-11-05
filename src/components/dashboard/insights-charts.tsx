import type { ReactNode } from "react";

/**
 * Small, dependency-free charts for the insights page, rendered on the
 * server as plain HTML: one series each, one colour, thin bars with rounded
 * data ends on a hairline baseline, a label only on the peak, a tooltip on
 * every bar (title) and a table view for screen readers and exact numbers.
 */

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums">{value.toLocaleString("en-GB")}</p>
    </div>
  );
}

export interface Bar {
  /** Shown under the bar (may be empty to keep labels sparse). */
  label: string;
  /** Full name for the tooltip and the table. */
  name: string;
  value: number;
}

function DataTable({ rows, nameHeader, valueHeader, summary }: { rows: Bar[]; nameHeader: string; valueHeader: string; summary: string }) {
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-brand">{summary}</summary>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 font-bold">{nameHeader}</th>
            <th className="py-1 text-right font-bold">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <td className="py-1">{r.name}</td>
              <td className="py-1 text-right tabular-nums">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Vertical bars (views per day, per hour). */
export function ColumnChart({
  title,
  hint,
  bars,
  unit,
  peakLabel,
  table,
}: {
  title: string;
  hint?: string;
  bars: Bar[];
  /** "{count} views" */
  unit: string;
  /** "Most: {count}" */
  peakLabel: string;
  table: { name: string; value: string; summary: string };
}) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  const peak = max > 0 ? bars.findIndex((b) => b.value === max) : -1;
  return (
    <figure className="space-y-2">
      <figcaption>
        <span className="block text-lg font-extrabold">{title}</span>
        {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </figcaption>
      <div className="relative h-36 border-b border-line pt-5" aria-hidden="true">
        {/* Hairline at the halfway mark. */}
        <div className="absolute inset-x-0 top-[calc(1.25rem+50%-0.625rem)] border-t border-line/70" />
        <div className="relative flex h-full items-end gap-[2px]">
          {bars.map((b, i) => (
            <div key={b.name} className="group relative flex h-full flex-1 items-end" title={`${b.name}: ${fill(unit, { count: b.value })}`}>
              {i === peak ? (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold">{fill(peakLabel, { count: max })}</span>
              ) : null}
              <div
                className="w-full rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80"
                style={{ height: max > 0 ? `${Math.max(b.value > 0 ? 2 : 0, (b.value / max) * 100)}%` : "0%" }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-[2px] text-xs text-muted" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.name} className="flex-1 overflow-visible whitespace-nowrap text-center">
            {b.label}
          </span>
        ))}
      </div>
      <DataTable rows={bars} nameHeader={table.name} valueHeader={table.value} summary={table.summary} />
    </figure>
  );
}

/** Horizontal ranked bars (most viewed dishes, tables). */
export function RankedBars({ title, rows, empty }: { title: string; rows: Bar[]; empty: ReactNode }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure className="space-y-2">
      <figcaption className="text-lg font-extrabold">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <li key={r.name} title={`${r.name}: ${r.value}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-bold">{r.name}</span>
                <span className="shrink-0 tabular-nums text-muted">{r.value}</span>
              </div>
              <div className="mt-1 h-2 rounded-r-[4px] bg-brand" style={{ width: `${max > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }} aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}
