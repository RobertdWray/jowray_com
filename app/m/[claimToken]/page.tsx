import { headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getMemoryForClaim } from "@/features/memories/claim";
import { isRenderableIn } from "@/lib/media-types";

import { linkClass } from "../../_components/field-classes";
import { ClaimForm } from "./claim-form";

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
        {memory.media.map((item) => {
          const src = `/api/media/${item.id}?t=${encodeURIComponent(claimToken)}`;
          const download = `${src}&download=1`;
          if (!isRenderableIn(item.mimeType, userAgent)) {
            return (
              <div key={item.id} className="rounded-card border-[3px] border-wood-light bg-paper p-3">
                <p>
                  <a className={linkClass} href={download}>Download {item.originalFilename ?? "file"}</a>{" "}
                  (this browser cannot display {item.mimeType})
                </p>
              </div>
            );
          }
          if (item.mimeType.startsWith("image/")) {
            // Private, token-gated media must not go through the image optimizer (it would cache the bytes).
            return (
              <div key={item.id} className="rounded-card border-[3px] border-wood-light bg-paper p-3">
                <Image
                  src={src}
                  alt={item.originalFilename ?? "photo"}
                  unoptimized
                  width={0}
                  height={0}
                  sizes="100vw"
                  className="h-auto w-full max-w-full rounded"
                />
              </div>
            );
          }
          if (item.mimeType.startsWith("audio/")) {
            return (
              <div key={item.id} className="rounded-card border-[3px] border-wood-light bg-paper p-3">
                <audio controls src={src} className="w-full" />
              </div>
            );
          }
          return (
            <div key={item.id} className="rounded-card border-[3px] border-wood-light bg-paper p-3">
              <video controls src={src} className="max-w-full rounded" />
            </div>
          );
        })}
      </section>
      <ClaimForm claimToken={claimToken} memory={memory} />
      <p className="text-small text-walnut-soft">Keep this link private: anyone who has it can edit this memory.</p>
    </>
  );
}
