import type { ComponentProps, ReactNode } from "react";

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-[var(--radius-card)] border border-line bg-card p-4 sm:p-5 ${className}`} {...props} />;
}

type Tone = "error" | "info" | "success" | "warning";

const tones: Record<Tone, string> = {
  error: "border-danger/40 bg-danger-soft text-danger",
  info: "border-line bg-card text-ink",
  success: "border-brand/30 bg-brand-soft text-brand-dark",
  warning: "border-accent-dark/40 bg-accent-soft text-ink",
};

export function Alert({ tone = "info", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border-2 px-4 py-3 text-base font-semibold ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

const badgeTones = {
  green: "bg-brand-soft text-brand-dark",
  yellow: "bg-accent-soft text-ink",
  red: "bg-danger-soft text-danger",
  grey: "bg-line/60 text-muted",
} as const;

export function Badge({ tone = "grey", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold ${badgeTones[tone]}`}>{children}</span>;
}
