import type { Metadata } from "next";

import { SecondaryLink } from "../_components/buttons";
import { linkClass } from "../_components/field-classes";
import { StitchedHeart } from "../_components/hearts";

export const metadata: Metadata = {
  title: "Jo Wray — Obituary",
  description:
    "Beloved wife, mother, grandmother, and retired kindergarten teacher Velma Josephine (Jo) Wray (née Hart) of Hunt Valley, Maryland, passed away peacefully on November 2, 2026, after a brief illness.",
};

// Static page: no request-time data, so it prerenders at build. The text is
// the family's obituary, verbatim; edit it here only when they change it.
export default function ObituaryPage() {
  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-[max(16px,5%)] py-10">
      <StitchedHeart size={40} />
      <div className="flex flex-col gap-3">
        <p className="text-body font-bold uppercase tracking-[0.08em] text-jo-red-deep">Obituary</p>
        <h1 className="font-display text-h2-sm font-bold sm:text-h2">
          Velma Josephine &quot;Jo&quot; Wray
        </h1>
      </div>
      <div className="flex flex-col gap-5 text-body leading-[1.6]">
        <p>
          Beloved wife, mother, grandmother, and retired kindergarten teacher Velma Josephine (Jo)
          Wray (née Hart) of Hunt Valley, Maryland, passed away peacefully on November 2, 2026, after
          a brief illness.
        </p>
        <p>
          Jo leaves behind her husband Richard Wray, her son Robert Wray and his wife, Tracy Gold, and
          her grandchild, Ava Goldwray. She also leaves her sister Kay Bartholomew, brother-in-law Doug
          Bartholomew, and nephews Andrew, Daniel, and Paul.
        </p>
        <p>
          During her career as a lower elementary school teacher, Jo loved nourishing and educating
          children. Some of her students reached out decades later to let her family know how much
          she meant to them as a teacher. Being a grandmother to Ava revived Jo&rsquo;s love of
          enriching children&rsquo;s lives with stories, games, crafts, and of course, many stuffed
          animals! Jo loved sewing, quilting, and even better, hunting a good bargain on craft
          supplies. If a craft involved a heart, Jo loved it even more because of her maiden name,
          Hart.
        </p>
        <p>
          Jo and Richard were married in 1971 on Christmas Eve. She loved Christmas and supported
          Richard&rsquo;s retirement job as mall Santa. But you better not call her Mrs. Claus unless
          you wanted to get put on the naughty list! Jo Wray stuck to her own name and her own story.
        </p>
        <p>
          Richard, Jo, and Rob spent many summers in Lake George, New York, boating, hiking, and
          enjoying time with extended family. After retirement, Richard and Jo were able to spend
          even more time in Lake George, where Jo was active in Ticonderoga Methodist Church.
        </p>
        <p>
          Richard and Jo spent the winters in their longtime home in Reisterstown, Maryland, before
          they moved into the Broadmead retirement community. Jo enjoyed keeping plants on the patio,
          attending lectures and community events, and shopping at the Amish market.
        </p>
        <p>
          Jo&rsquo;s cheeky giggle and love and caring for everyone she knew will be greatly missed.
        </p>
        <p>
          Celebration of life arrangements are pending. In lieu of flowers, please send donations to{" "}
          <a href="https://www.tifumc.com/" className={linkClass} rel="noopener">
            First United Methodist Church of Ticonderoga
          </a>
          .
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <SecondaryLink href="/share" className="min-w-0">
          Leave a memory of Jo
        </SecondaryLink>
      </div>
    </main>
  );
}
