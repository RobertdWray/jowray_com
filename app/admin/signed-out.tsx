import Link from "next/link";

import { linkClass } from "../_components/field-classes";

/** What every admin page shows without a session. The entry page is the way in. */
export function SignedOut() {
  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col gap-4 rounded-card border-[3px] border-wood-light bg-paper p-8 shadow-card">
      <h1 className="font-display text-h2-sm font-bold">Family admin</h1>
      <p className="text-body">Open the link Rob sent you, in the browser you&rsquo;ll keep using. It signs you in for 30 days.</p>
      <p className="text-body">
        Have the key but not the link?{" "}
        <Link href="/admin/enter" prefetch={false} className={linkClass}>
          Paste it here
        </Link>
        .
      </p>
    </section>
  );
}
