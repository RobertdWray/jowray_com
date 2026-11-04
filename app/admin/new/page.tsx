import { connection } from "next/server";
import { Suspense } from "react";

import { hasAdminSession } from "../_session";
import { DraftForm } from "../draft-form";
import { SignedOut } from "../signed-out";

// The draft Server Function in ../actions.ts inherits this limit.
export const maxDuration = 30;

export default function AdminNewPage() {
  return (
    <Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>
      <NewDraft />
    </Suspense>
  );
}

async function NewDraft() {
  await connection();
  if (!(await hasAdminSession())) {
    return <SignedOut />;
  }
  return (
    <section className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <h1 className="font-display text-h2-sm font-bold">Draft a memory for someone</h1>
      <p className="text-body">
        Paste the words someone sent you in an email, a text or a card, exactly as they wrote them. They get a private link to change anything,
        add a photo or a recording, and press Share. Nothing is visible to anyone until they do.
      </p>
      <DraftForm />
    </section>
  );
}
