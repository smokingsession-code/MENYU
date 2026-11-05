"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, describedBy } from "@/components/ui/field";
import { formatPhoneLocal } from "@/lib/phone";
import { loginAction, type LoginState } from "./actions";

export type LoginMessages = Record<
  | "auth.phoneLabel"
  | "auth.phonePlaceholder"
  | "auth.phoneHint"
  | "auth.sendCode"
  | "auth.sending"
  | "auth.useEmail"
  | "auth.usePhone"
  | "auth.emailLabel"
  | "auth.emailPlaceholder"
  | "auth.emailHint"
  | "auth.codeLabel"
  | "auth.codeSentPhone"
  | "auth.codeSentEmail"
  | "auth.verify"
  | "auth.verifying"
  | "auth.resend"
  | "auth.resendIn"
  | "auth.changeNumber"
  | "auth.changeEmail"
  | "auth.devHint",
  string
>;

const RESEND_AFTER_SECONDS = 30;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function LoginForm({ m, devHint }: { m: LoginMessages; devHint: boolean }) {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { step: "start", method: "phone" });
  const [method, setMethod] = useState(state.method);
  const [lastServerMethod, setLastServerMethod] = useState(state.method);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // When the server answers with a different method (e.g. after "reset"),
  // follow it. Adjusting state during render avoids an extra effect pass.
  if (state.method !== lastServerMethod) {
    setLastServerMethod(state.method);
    setMethod(state.method);
  }

  // Countdown before "Send a new code" is allowed.
  useEffect(() => {
    if (state.step !== "code" || !state.sentAt) return;
    const tick = () => setSecondsLeft(Math.max(0, RESEND_AFTER_SECONDS - Math.floor((Date.now() - state.sentAt!) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state.step, state.sentAt]);

  // Android Chrome can read the code from the SMS (WebOTP) and fill it in.
  useEffect(() => {
    if (state.step !== "code" || state.method !== "phone" || !("OTPCredential" in window)) return;
    const abort = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: abort.signal } as CredentialRequestOptions)
      .then((credential) => {
        const code = (credential as unknown as { code?: string } | null)?.code;
        if (code && codeRef.current && formRef.current) {
          codeRef.current.value = code;
          formRef.current.requestSubmit();
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [state.step, state.method, state.sentAt]);

  if (state.step === "code") {
    const sentTo =
      state.method === "phone" && state.phone
        ? fill(m["auth.codeSentPhone"], { phone: formatPhoneLocal(state.phone) })
        : fill(m["auth.codeSentEmail"], { email: state.email ?? "" });
    return (
      <form ref={formRef} action={action} className="space-y-5" noValidate>
        <input type="hidden" name="method" value={state.method} />
        <input type="hidden" name="next" value={next} />
        <p className="text-base">{sentTo}</p>
        <Field id="code" label={m["auth.codeLabel"]} error={state.error}>
          <Input
            ref={codeRef}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            aria-invalid={state.error ? true : undefined}
            aria-describedby={describedBy("code", undefined, state.error)}
            className="text-center text-2xl font-extrabold tracking-[0.4em]"
          />
        </Field>
        {devHint ? <p className="text-sm text-muted">{m["auth.devHint"]}</p> : null}
        <Button type="submit" name="intent" value="verify" size="lg" className="w-full" disabled={pending}>
          {pending ? m["auth.verifying"] : m["auth.verify"]}
        </Button>
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            name="intent"
            value="send"
            variant="ghost"
            formNoValidate
            disabled={pending || secondsLeft > 0}
          >
            {secondsLeft > 0 ? fill(m["auth.resendIn"], { seconds: secondsLeft }) : m["auth.resend"]}
          </Button>
          <Button type="submit" name="intent" value="reset" variant="ghost" formNoValidate disabled={pending}>
            {state.method === "phone" ? m["auth.changeNumber"] : m["auth.changeEmail"]}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="intent" value="send" />
      <input type="hidden" name="next" value={next} />
      {method === "phone" ? (
        <Field id="phone" label={m["auth.phoneLabel"]} hint={m["auth.phoneHint"]} error={state.error}>
          <div className="flex">
            <span className="inline-flex min-h-12 items-center rounded-l-xl border-2 border-r-0 border-line bg-paper px-3 text-base font-bold text-muted">
              +256
            </span>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={m["auth.phonePlaceholder"]}
              defaultValue={state.phone ? formatPhoneLocal(state.phone) : ""}
              required
              autoFocus
              aria-invalid={state.error ? true : undefined}
              aria-describedby={describedBy("phone", m["auth.phoneHint"], state.error)}
              className="rounded-l-none"
            />
          </div>
        </Field>
      ) : (
        <Field id="email" label={m["auth.emailLabel"]} hint={m["auth.emailHint"]} error={state.error}>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={m["auth.emailPlaceholder"]}
            defaultValue={state.email ?? ""}
            required
            autoFocus
            aria-invalid={state.error ? true : undefined}
            aria-describedby={describedBy("email", m["auth.emailHint"], state.error)}
          />
        </Field>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? m["auth.sending"] : m["auth.sendCode"]}
      </Button>
      <Button
        variant="ghost"
        className="w-full"
        onClick={() => setMethod(method === "phone" ? "email" : "phone")}
        disabled={pending}
      >
        {method === "phone" ? m["auth.useEmail"] : m["auth.usePhone"]}
      </Button>
      {state.error && method !== state.method ? <Alert tone="error">{state.error}</Alert> : null}
    </form>
  );
}
