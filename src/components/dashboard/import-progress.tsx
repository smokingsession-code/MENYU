"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discardImportAction, importStatusAction, retryImportAction } from "@/app/(site)/dashboard/[restaurantId]/import/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";

/**
 * Shown while Claude reads the menu. Asks for the status every few seconds
 * (less often as time goes on) and reloads the page once it changes.
 */
export function ImportProgress({
  restaurantId,
  importId,
  startedAt,
  s,
}: {
  restaurantId: string;
  importId: string;
  startedAt: string;
  s: Record<string, string>;
}) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const began = new Date(startedAt).getTime();
    const tick = async () => {
      if (stopped) return;
      const elapsed = Date.now() - began;
      setSlow(elapsed > 90_000);
      try {
        const result = await importStatusAction(restaurantId, importId);
        if (stopped) return;
        if ("status" in result && result.status !== "processing") return router.refresh();
        if (!("status" in result)) return router.refresh();
      } catch {
        // Offline for a moment: keep trying.
      }
      timer = setTimeout(tick, elapsed > 60_000 ? 6000 : 3000);
    };
    timer = setTimeout(tick, 2500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [restaurantId, importId, startedAt, router]);

  return (
    <div className="space-y-3 text-center" role="status" aria-live="polite">
      <div aria-hidden="true" className="mx-auto size-12 animate-spin rounded-full border-4 border-brand-soft border-t-brand" />
      <h1 className="text-2xl font-extrabold">{s.processingTitle}</h1>
      <p className="text-muted">{s.processingBody}</p>
      {slow ? <p className="font-bold">{s.processingSlow}</p> : null}
    </div>
  );
}

export function RetryImportButton({ restaurantId, importId, s }: { restaurantId: string; importId: string; s: Record<string, string> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await retryImportAction(restaurantId, importId);
            if (!result.ok) return setError(result.error);
            router.refresh();
          })
        }
      >
        {pending ? s.retrying : s.retry}
      </Button>
    </div>
  );
}

export function DiscardImportButton({
  restaurantId,
  importId,
  s,
  then,
}: {
  restaurantId: string;
  importId: string;
  s: Record<string, string>;
  /** Where to go afterwards. */
  then: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="danger"
        className="w-full"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(s.discardConfirm)) return;
          start(async () => {
            const result = await discardImportAction(restaurantId, importId);
            if (!result.ok) return setError(result.error);
            router.push(then);
          });
        }}
      >
        {s.discard}
      </Button>
    </div>
  );
}
