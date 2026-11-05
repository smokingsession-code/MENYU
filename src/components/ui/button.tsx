import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "brand" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold text-center select-none " +
  "transition-colors disabled:opacity-60 disabled:cursor-not-allowed aria-disabled:opacity-60";

const variants: Record<Variant, string> = {
  // Warm yellow with dark text: the main action on every screen.
  primary: "bg-accent text-ink hover:bg-accent-dark active:bg-accent-dark",
  brand: "bg-brand text-white hover:bg-brand-dark active:bg-brand-dark",
  outline: "bg-card text-brand border-2 border-brand hover:bg-brand-soft",
  ghost: "bg-transparent text-brand hover:bg-brand-soft",
  danger: "bg-card text-danger border-2 border-danger hover:bg-danger-soft",
};

// Every size keeps the tap target at least 44px tall.
const sizes: Record<Size, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** For links that leave the app (WhatsApp, tel:, maps). */
export function ButtonAnchor({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"a"> & { variant?: Variant; size?: Size }) {
  return <a className={buttonClass(variant, size, className)} {...props} />;
}
