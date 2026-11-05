"use client";

import { useEffect, useRef, useTransition } from "react";
import { deleteFeedbackAction, markFeedbackReadAction } from "@/app/(site)/dashboard/[restaurantId]/feedback/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";

export interface FeedbackRow {
  id: string;
  rating: number;
  comment: string | null;
  table: string | null;
  when: string;
  unread: boolean;
}

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="text-xl leading-none tracking-wide">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" style={{ color: n <= Math.round(rating) ? "#F4B400" : "#C9C4B8" }}>
          ★
        </span>
      ))}
    </span>
  );
}

export function FeedbackList({
  restaurantId,
  rows,
  canDelete,
  s,
}: {
  restaurantId: string;
  rows: FeedbackRow[];
  canDelete: boolean;
  s: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const marked = useRef(false);
  // Seen now: still marked "New" on this visit, not on the next one.
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    const unread = rows.filter((r) => r.unread).map((r) => r.id);
    if (unread.length) void markFeedbackReadAction(restaurantId, unread);
  }, [restaurantId, rows]);

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className={`space-y-1 rounded-[var(--radius-card)] border bg-card p-4 ${r.unread ? "border-accent-dark" : "border-line"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Stars rating={r.rating} label={fill(s.stars, { count: r.rating })} />
            <span className="flex items-center gap-2 text-sm text-muted">
              {r.unread ? <Badge tone="yellow">{s.new}</Badge> : null}
              {r.when}
            </span>
          </div>
          <p className={r.comment ? "text-base" : "text-muted"}>{r.comment ?? s.noComment}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {r.table ? <span className="text-sm font-bold text-muted">{fill(s.table, { table: r.table })}</span> : <span />}
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(s.deleteConfirm)) start(async () => void (await deleteFeedbackAction(restaurantId, r.id)));
                }}
              >
                {s.delete}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
