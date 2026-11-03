import { headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getMemoryForClaim } from "@/features/memories/claim";
import { isRenderableIn } from "@/lib/media-types";

import { ClaimForm } from "./claim-form";

// Static shell; the token is read at request time inside <Suspense>. The
// Referrer-Policy header for /m/* comes from next.config.ts; the meta tag
// covers the document itself. No third-party assets are loaded here.
export const maxDuration = 120;

export default function ClaimPage(props: PageProps<"/m/[claimToken]">) {
  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <meta name="referrer" content="same-origin" />
      <h1 className="text-2xl font-semibold">Your memory</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <ClaimContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function ClaimContent({ params }: { params: PageProps<"/m/[claimToken]">["params"] }) {
  const { claimToken } = await params;
  const userAgent = (await headers()).get("user-agent");
  const memory = await getMemoryForClaim(claimToken);
  if (!memory) {
    notFound();
  }
  return (
    <>
      <section className="space-y-3">
        {memory.contributorNote && <blockquote className="whitespace-pre-wrap border-l-4 pl-4">{memory.contributorNote}</blockquote>}
        {memory.media.length === 0 && memory.type !== "TEXT" && <p>No file has been received yet.</p>}
        {memory.media.map((item) => {
          const src = `/api/media/${item.id}?t=${encodeURIComponent(claimToken)}`;
          const download = `${src}&download=1`;
          if (!isRenderableIn(item.mimeType, userAgent)) {
            return <p key={item.id}><a className="underline" href={download}>Download {item.originalFilename ?? "file"}</a> (this browser cannot display {item.mimeType})</p>;
          }
          if (item.mimeType.startsWith("image/")) {
            // Private, token-gated media must not go through the image optimizer (it would cache the bytes).
            return (
              <Image
                key={item.id}
                src={src}
                alt={item.originalFilename ?? "photo"}
                unoptimized
                width={0}
                height={0}
                sizes="100vw"
                className="h-auto w-full max-w-full rounded"
              />
            );
          }
          if (item.mimeType.startsWith("audio/")) {
            return <audio key={item.id} controls src={src} className="w-full" />;
          }
          return <video key={item.id} controls src={src} className="max-w-full rounded" />;
        })}
      </section>
      <ClaimForm claimToken={claimToken} memory={memory} />
      <p className="text-sm">Keep this link private: anyone who has it can edit this memory.</p>
    </>
  );
}
