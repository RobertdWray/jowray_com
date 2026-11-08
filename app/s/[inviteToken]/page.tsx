import { connection } from "next/server";
import { Suspense } from "react";

import { getInvitePrefill } from "@/features/invites/resolve-invite";

import { Intro } from "../../share/intro";
import { ShareForm } from "../../share/share-form";

// The Server Functions in ../../share/actions.ts inherit this page's limit; it bounds
// finalizeUpload(), completeSubmission() (the receipt send, including its
// bounded wait for the outbound lock) and the after() work they schedule.
export const maxDuration = 120;

// Static shell; only the content inside Suspense reads the token at request time.
export default function InvitePage(props: PageProps<"/s/[inviteToken]">) {
  return (
    <main className="flex flex-1 flex-col">
      <meta name="referrer" content="no-referrer" />
      <Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>
        <InviteContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function InviteContent({ params }: { params: PageProps<"/s/[inviteToken]">["params"] }) {
  // A known URL does not stop runtime prefetch prerendering; connection() keeps the lookup request-time.
  await connection();
  const { inviteToken } = await params;
  const prefill = await getInvitePrefill(inviteToken);
  return (
    <ShareForm
      intro={<Intro greeting={prefill ? `Hi ${prefill.firstName},` : undefined} />}
      prefill={prefill ?? undefined}
    />
  );
}
