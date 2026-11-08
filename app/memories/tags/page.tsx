import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listPublicMemories } from "@/features/memories/public";
import { buildQuilt, type QuiltModel } from "@/lib/memories/explore";
import { parseTagsQuery } from "@/lib/validations/public-memories";
import { getPublicMemoriesEnv } from "@/server/config/env";

import { EmptyState, LoadMore, OpeningSoon } from "../_components/bands";
import { bandClass, cardGridClass, eyebrowClass, innerClass, linkButtonClass, paperBandClass } from "../_components/chips";
import { exploreHref, tagsHref } from "../_components/hrefs";
import { MemoryCard } from "../_components/memory-card";
import { TagQuilt } from "../_components/tag-quilt";
import { ViewNav } from "../_components/view-nav";

export const metadata: Metadata = {
  title: "What she loved — Jo Wray",
  description: "A quilt of everything Jo loved: tap a patch to read the memories that carry it.",
  robots: { index: false, follow: false },
};

export default function TagsPage(props: PageProps<"/memories/tags">) {
  return (
    <main className="flex flex-1 flex-col">
      <section aria-labelledby="tags-h" className={`${bandClass} pb-4 pt-4 sm:pb-10 sm:pt-6`}>
        <div className={`${innerClass} flex flex-col gap-3 sm:gap-5`}>
          <p className={eyebrowClass}>Memories of Jo · by what she loved</p>
          <h1 id="tags-h" className="max-w-[14em] font-display text-display-sm font-extrabold sm:text-display">
            A quilt of everything she loved
          </h1>
          <p className="max-w-[36em] text-label font-normal sm:text-lead">
            Every memory gets a few patches: what it&rsquo;s about, who&rsquo;s in it, what Jo was up to. The bigger the patch, the more stories. Tap one and the quilt shows you those.
          </p>
          <ViewNav current="tags" />
        </div>
      </section>
      <Suspense fallback={<p className={`${bandClass} py-8 text-body text-walnut-soft`}>Loading…</p>}>
        <TagsContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function TagsContent({ searchParams }: { searchParams: PageProps<"/memories/tags">["searchParams"] }) {
  await connection();
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return <OpeningSoon />;
  }
  const { tag, n } = parseTagsQuery(await searchParams);
  const model = buildQuilt(await listPublicMemories(), tag, n);
  return (
    <>
      <section aria-label="The patch quilt" className={`${bandClass} pb-8 sm:pb-14`}>
        <div className={`${innerClass} flex flex-col gap-[14px]`}>
          {model.patches.length > 0 ? (
            <TagQuilt patches={model.patches} hrefFor={(slug) => tagsHref(slug)} />
          ) : (
            <EmptyState>No patches yet. Jo&rsquo;s family adds them as they read each memory.</EmptyState>
          )}
          {/* D3: patches are set by the family (the admin page and the MCP tools); the board's note implied automatic tagging. */}
          <p className="max-w-[50em] text-small text-walnut-soft">Jo&rsquo;s family sews the patches on as they read each memory. A memory can carry several.</p>
        </div>
      </section>
      {model.selected && <SelectedPatch model={model} />}
    </>
  );
}

function SelectedPatch({ model }: { model: QuiltModel }) {
  const selected = model.selected!;
  return (
    <section aria-labelledby="patch-h" className={`${bandClass} ${paperBandClass} pb-10 pt-6 sm:pb-[72px] sm:pt-14`}>
      <div className={`${innerClass} flex flex-col gap-5 sm:gap-7`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-2">
            {model.eyebrow && <p className={eyebrowClass}>{model.eyebrow}</p>}
            <h2 id="patch-h" className="break-words font-display text-h2-sm font-bold sm:text-h2">
              {selected.name}
            </h2>
            {model.neighbors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="mr-1 text-label font-bold" id="next-to-label">
                  Often stitched next to:
                </span>
                <ul aria-labelledby="next-to-label" className="flex flex-wrap gap-2">
                  {model.neighbors.map((neighbor) => (
                    <li key={neighbor.slug}>
                      <Link
                        href={tagsHref(neighbor.slug)}
                        prefetch={false}
                        scroll={false}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border-[3px] border-dashed border-periwinkle bg-paper px-4 text-label font-bold text-walnut no-underline"
                      >
                        {neighbor.name}
                        <span className="font-normal opacity-90">{neighbor.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Link href={exploreHref({ tag: selected.slug })} className={`${linkButtonClass} px-[22px]`}>
            Mix this with a place or a year
          </Link>
        </div>
        <ul className={cardGridClass}>
          {model.shown.map((memory, index) => (
            <MemoryCard key={memory.id} memory={memory} index={index} variant="tags" selectedTag={selected.slug} />
          ))}
        </ul>
        {model.nextN !== null && <LoadMore href={tagsHref(selected.slug, model.nextN)} more={model.moreCount} total={model.total} />}
      </div>
    </section>
  );
}
