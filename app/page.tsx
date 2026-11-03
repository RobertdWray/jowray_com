import Image from "next/image";
import Link from "next/link";

import joSanta from "@/public/photos/jo-santa.jpg";

import { PrimaryLink, SecondaryLink } from "./_components/buttons";
import { StitchedHeart } from "./_components/hearts";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section
        id="top"
        className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-16 gap-y-12 px-[max(16px,5%)] pb-[72px] pt-10"
      >
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-6">
          <p className="text-body font-bold uppercase tracking-[0.08em] text-jo-red-deep">
            Velma Josephine &quot;Jo&quot; Wray, née Hart
          </p>
          <h1 className="font-display text-display-sm font-extrabold sm:text-display">
            Tell us a <span className="text-jo-red">Jo</span> story.
          </h1>
          <p className="max-w-[34em] text-lead">
            Teacher, quilter, bargain hunter, grandmother, and owner of a very cheeky giggle. Her family is
            gathering memories of her — from her students, her church friends, her neighbors, and anyone
            she ever teased. We&apos;d love yours.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <PrimaryLink href="/share" className="min-w-0">
              <StitchedHeart size={26} color="#fff" />
              Leave a memory of Jo
            </PrimaryLink>
            <SecondaryLink href="#story" className="min-w-0">
              Read Jo&apos;s story
            </SecondaryLink>
          </div>
        </div>
        <figure className="flex min-w-0 max-w-[560px] flex-[1_1_400px] -rotate-[1.5deg] flex-col items-center">
          <div className="patchwork w-full rounded-[6px] p-4 shadow-photo">
            <div className="flex flex-col gap-3 rounded-[3px] bg-paper px-[14px] pb-[18px] pt-[14px]">
              <Image
                src={joSanta}
                alt="Jo in a red embroidered top, laughing beside her son Rob and her husband Richard in his full Santa beard and suit, at a restaurant table"
                sizes="(min-width: 900px) 560px, 100vw"
                preload
                className="block aspect-[4/3] w-full rounded-[3px] object-cover"
              />
              <figcaption className="text-center font-display text-body leading-[1.35]">
                Jo, her son Rob, and Santa. You could call him Santa. You could <em>not</em> call her
                Mrs. Claus.
              </figcaption>
            </div>
          </div>
          <span className="relative -top-7 inline-block rotate-[4deg] rounded-full bg-jo-red px-[14px] py-2 text-small font-bold text-paper shadow-pill">
            Christmas, Hunt Valley
          </span>
        </figure>
      </section>

      <section
        id="ways"
        className="border-y-[3px] border-dashed border-jo-red bg-paper px-[max(16px,5%)] py-16"
      >
        <div className="mx-auto flex max-w-[1200px] flex-col gap-8">
          <div className="flex flex-col gap-[10px]">
            <h2 className="font-display text-h2-sm font-bold sm:text-h2">
              Three ways to share. Pick the easiest one.
            </h2>
            <p className="max-w-[40em] text-body">
              A voice memo counts. A photo from a shoebox counts. Three sentences count. Jo kept every
              drawing a student ever gave her, so nothing is too small.
            </p>
          </div>
          <div className="flex flex-wrap gap-5">
            <Link
              href="/share#record"
              className="flex min-h-[220px] min-w-0 flex-[1_1_200px] flex-col justify-between gap-4 rounded-card bg-jo-red p-6 text-white no-underline shadow-card-red motion-safe:transition-transform motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-card-red-hover"
            >
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
              </svg>
              <span className="flex flex-col gap-[6px]">
                <span className="font-display text-card-title font-bold">Record here</span>
                <span className="text-[18px] leading-[1.4]">Tap once, tell the story, tap again.</span>
              </span>
            </Link>
            <Link
              href="/share#form"
              className="flex min-h-[220px] min-w-0 flex-[1_1_200px] flex-col justify-between gap-4 rounded-card border-[3px] border-wood-light bg-muslin p-6 text-walnut no-underline shadow-card motion-safe:transition-transform motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-card-hover"
            >
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#A50D26"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="10" r="2" />
                <path d="M21 16l-5-5-8 8" />
              </svg>
              <span className="flex flex-col gap-[6px]">
                <span className="font-display text-card-title font-bold">Upload a photo or video</span>
                <span className="text-[18px] leading-[1.4]">From your phone or that shoebox.</span>
              </span>
            </Link>
            <Link
              href="/share#form"
              className="flex min-h-[220px] min-w-0 flex-[1_1_200px] flex-col justify-between gap-4 rounded-card border-[3px] border-wood-light bg-muslin p-6 text-walnut no-underline shadow-card motion-safe:transition-transform motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-card-hover"
            >
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#A50D26"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" />
                <path d="M13 7l3 3" />
              </svg>
              <span className="flex flex-col gap-[6px]">
                <span className="font-display text-card-title font-bold">Write a note</span>
                <span className="text-[18px] leading-[1.4]">
                  A sentence or a page. Spelling doesn&apos;t count.
                </span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section id="story" className="bg-lake-green px-[max(16px,5%)] py-[72px] text-[#fffdf8]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-x-16 gap-y-8">
          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-[14px]">
            <h2 className="font-display text-h2-sm font-bold sm:text-h2">Jo&apos;s story</h2>
            <p className="text-body text-paper">
              Hunt Valley, Maryland, by way of Reisterstown and a lot of summers on Lake George.
            </p>
          </div>
          <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-5 text-body leading-[1.6]">
            <p>
              During her career as a lower elementary school teacher, Jo loved nourishing and educating
              children. Some of her students reached out decades later to let her family know how much
              she meant to them. Being a grandmother to Ava revived Jo&apos;s love of stories, games,
              crafts, and of course, many stuffed animals.
            </p>
            <p>
              Jo loved sewing, quilting, and even better, hunting a good bargain on craft supplies. If a
              craft involved a heart, Jo loved it even more because of her maiden name, Hart.
            </p>
            <p className="rounded-[14px] bg-[rgb(255_253_248/0.12)] px-[22px] py-[18px] font-display text-[24px] leading-[1.4]">
              Jo and Richard were married on Christmas Eve. She loved Christmas and supported
              Richard&apos;s retirement job as a mall Santa. But you&apos;d better not call her Mrs. Claus
              unless you wanted to get put on the naughty list. Jo Wray stuck to her own name and her
              own story.
            </p>
            <p className="text-body">
              <Link
                href="/obituary"
                className="text-paper underline underline-offset-4 hover:decoration-2"
              >
                Read Jo&apos;s full obituary
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
