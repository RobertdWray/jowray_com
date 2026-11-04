"use client";

import { useEffect, useRef, useState } from "react";

import { PrimaryButton } from "../_components/buttons";
import { inputClass, labelClass } from "../_components/field-classes";
import { enterAdmin } from "./actions";

type State = { kind: "idle" } | { kind: "signing_in" } | { kind: "failed" };

/**
 * The way in (plan §3.3). The link is `/admin/enter#key=<secret>`: the fragment
 * never reaches a server, so the key appears in no request log. On mount the
 * key is read, dropped from the address bar, put in the form and submitted;
 * the paste box is for a link whose fragment a messaging app stripped.
 */
export function EnterForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (!key) {
      return;
    }
    // Out of the address bar (and so out of any later Referer or history copy) before anything else.
    window.history.replaceState(null, "", "/admin/enter");
    const form = formRef.current;
    const input = form?.elements.namedItem("key");
    if (form && input instanceof HTMLInputElement) {
      // Through the form, so the state change happens in the submit handler, not in this effect.
      input.value = key;
      form.requestSubmit();
    }
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = String(new FormData(form).get("key") ?? "").trim();
    form.reset();
    if (key.length === 0) {
      return;
    }
    setState({ kind: "signing_in" });
    try {
      // On success the Server Function redirects; only a refusal returns here.
      const result = await enterAdmin({ key });
      if (result && !result.ok) {
        setState({ kind: "failed" });
      }
    } catch {
      setState({ kind: "failed" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state.kind === "signing_in" && (
        <p className="text-body" role="status">
          Signing you in…
        </p>
      )}
      {state.kind === "failed" && (
        <p className="text-body text-jo-red-deep" role="alert">
          That key didn&rsquo;t work, or it&rsquo;s expired. Ask Rob for a fresh one.
        </p>
      )}
      <p className="text-body">Open this link in the browser you&rsquo;ll keep using. A link tapped inside Mail or Messages signs in that app&rsquo;s browser, not Safari.</p>
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-form border-[3px] border-wood-light bg-paper p-6 shadow-form" aria-busy={state.kind === "signing_in"}>
        <label className={labelClass}>
          <span>Paste the key</span>
          <input name="key" type="password" autoComplete="off" maxLength={256} className={inputClass} />
        </label>
        <PrimaryButton type="submit" disabled={state.kind === "signing_in"}>
          Sign in
        </PrimaryButton>
      </form>
    </div>
  );
}
