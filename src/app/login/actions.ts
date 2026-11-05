"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { isAllowedSmsDestination, normalizePhone, toE164 } from "@/lib/phone";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

export type LoginMethod = "phone" | "email";

export interface LoginState {
  step: "start" | "code";
  method: LoginMethod;
  phone?: string;
  email?: string;
  error?: string;
  /** Milliseconds since epoch when the last code was sent. */
  sentAt?: number;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One action drives the whole sign-in form:
 *   intent=send   -> send a code by SMS or email
 *   intent=verify -> check the code, sign in, accept invitations, redirect
 *   intent=reset  -> back to the first step
 */
export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = getTranslator("en");
  const intent = String(formData.get("intent") ?? "send");
  const method: LoginMethod = formData.get("method") === "email" ? "email" : "phone";

  if (intent === "reset") return { step: "start", method };

  const ip = await clientKey();
  const supabase = await createClient();

  if (intent === "send") {
    if (!(await rateLimit(`otp-send:ip:${ip}`, 20, 15 * 60))) {
      return { ...prev, method, error: t("auth.errors.tooMany") };
    }

    if (method === "phone") {
      const phone = normalizePhone(String(formData.get("phone") ?? prev.phone ?? ""));
      if (!phone) return { step: "start", method, error: t("auth.errors.invalidPhone") };
      if (!isAllowedSmsDestination(phone, serverEnv.smsAllowedCountryCodes)) {
        return { step: "start", method, phone, error: t("auth.errors.phoneCountry") };
      }
      if (!(await rateLimit(`otp-send:phone:${phone}`, 5, 60 * 60))) {
        return { step: prev.step, method, phone, error: t("auth.errors.tooMany") };
      }
      const { error } = await supabase.auth.signInWithOtp({ phone: toE164(phone) });
      if (error) {
        console.warn("[login] SMS code not sent", { status: error.status, code: error.code });
        return {
          step: "start",
          method,
          phone,
          error: error.status === 429 ? t("auth.errors.tooMany") : t("auth.errors.smsFailed"),
        };
      }
      return { step: "code", method, phone, sentAt: Date.now() };
    }

    const email = String(formData.get("email") ?? prev.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) {
      return { step: "start", method, email, error: t("auth.errors.invalidEmail") };
    }
    if (!(await rateLimit(`otp-send:email:${email}`, 5, 60 * 60))) {
      return { step: prev.step, method, email, error: t("auth.errors.tooMany") };
    }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      console.warn("[login] email code not sent", { status: error.status, code: error.code });
      return {
        step: "start",
        method,
        email,
        error: error.status === 429 ? t("auth.errors.tooMany") : t("auth.errors.emailFailed"),
      };
    }
    return { step: "code", method, email, sentAt: Date.now() };
  }

  // intent === "verify"
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  const target = method === "phone" ? prev.phone : prev.email;
  if (!target) return { step: "start", method };
  if (token.length !== 6) return { ...prev, error: t("auth.errors.invalidCode") };

  if (!(await rateLimit(`otp-verify:${method}:${target}`, 10, 15 * 60))) {
    return { ...prev, error: t("auth.errors.tooMany") };
  }

  const { error } =
    method === "phone"
      ? await supabase.auth.verifyOtp({ phone: toE164(target), token, type: "sms" })
      : await supabase.auth.verifyOtp({ email: target, token, type: "email" });
  if (error) return { ...prev, error: t("auth.errors.invalidCode") };

  // Turn any invitation for this phone or email into access.
  await supabase.rpc("claim_invitations");

  const next = safeNextPath(formData.get("next"));
  if (next) redirect(next);
  const { data: admin } = await supabase.from("admins").select("user_id").maybeSingle();
  redirect(admin ? "/admin" : "/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
