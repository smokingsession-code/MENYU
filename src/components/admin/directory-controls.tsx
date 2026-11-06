"use client";

import { useTransition, type ReactNode } from "react";
import { setDirectoryEnabledAction, setFeaturedAction, setListingAction } from "@/app/(site)/admin/directory/actions";
import { Button } from "@/components/ui/button";

type Variant = "primary" | "brand" | "outline" | "ghost" | "danger";

function ActionButton({ run, children, variant = "outline" }: { run: () => Promise<unknown>; children: ReactNode; variant?: Variant }) {
  const [pending, start] = useTransition();
  return (
    <Button variant={variant} size="sm" disabled={pending} onClick={() => start(async () => void (await run()))}>
      {children}
    </Button>
  );
}

export function DirectorySwitch({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <ActionButton run={() => setDirectoryEnabledAction(!enabled)} variant={enabled ? "danger" : "primary"}>
      {label}
    </ActionButton>
  );
}

export function ListingButtons({
  restaurantId,
  status,
  featured,
  canFeature,
  s,
}: {
  restaurantId: string;
  status: string;
  featured: boolean;
  canFeature: boolean;
  s: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "approved" ? (
        <ActionButton run={() => setListingAction(restaurantId, "approved")} variant="brand">
          {s.approve}
        </ActionButton>
      ) : null}
      {status === "pending" ? <ActionButton run={() => setListingAction(restaurantId, "rejected")}>{s.reject}</ActionButton> : null}
      {status === "approved" ? <ActionButton run={() => setListingAction(restaurantId, "hidden")}>{s.unlist}</ActionButton> : null}
      {status === "approved" && canFeature ? (
        <ActionButton run={() => setFeaturedAction(restaurantId, !featured)} variant="ghost">
          {featured ? s.unfeature : s.feature}
        </ActionButton>
      ) : null}
    </div>
  );
}
