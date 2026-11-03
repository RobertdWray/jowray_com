import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getMemoryForClaim } from "@/features/memories/claim";

import { ClaimForm } from "./claim-form";
import { MediaList } from "./media-list-client";

// Static shell; the token is read at request time inside <Suspense>.
// `Referrer-Policy: no-referrer` comes from `next.config.ts` for `/m/*`;
// this meta repeats it for the document so no later rule can widen it.
// The header links and prefetches below must never carry the token.
export const maxDuration = 120;

export default function ClaimPage(props: PageProps<"/m/[claimToken]">) {
  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-[max(16px,5%)] py-10">
      <meta name="referrer" content="no-referrer" />
      <h1 className="font-display text-h2-sm font-bold sm:text-h2">Your memory</h1>
      <Suspense fallback={<p className="text-body text-walnut-soft">Loading…</p>}>
        <ClaimContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function ClaimContent({ params }: { params: PageProps<"/m/[claimToken]">["params"] }) {
  // `params` alone does not stop a runtime prefetch prerender (the URL is
  // known), and the Neon driver uses randomBytes on connect; connection()
  // makes everything below request-time.
  await connection();
  const { claimToken } = await params;
  const userAgent = (await headers()).get("user-agent");
  const memory = await getMemoryForClaim(claimToken);
  if (!memory) {
    notFound();
  }
  return (
    <>
      <section className="space-y-3">
        {memory.contributorNote && (
          <blockquote className="whitespace-pre-wrap rounded-card border-[3px] border-wood-light bg-paper p-6 text-body shadow-card">
            {memory.contributorNote}
          </blockquote>
        )}
        {memory.media.length === 0 && memory.type !== "TEXT" && (
          <p className="text-body text-walnut-soft">No file has been received yet.</p>
        )}
        <MediaList claimToken={claimToken} media={memory.media} userAgent={userAgent} />
      </section>
      <ClaimForm claimToken={claimToken} memory={memory} />
      <p className="text-small text-walnut-soft">Keep this link private: anyone who has it can edit this memory.</p>
    </>
  );
}
