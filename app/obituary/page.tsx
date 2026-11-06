import type { Metadata } from "next";

import { SecondaryLink } from "../_components/buttons";
import { ROB_URL, TRACY_URL } from "../_components/external-links";
import { linkClass } from "../_components/field-classes";
import { StitchedHeart } from "../_components/hearts";

export const metadata: Metadata = {
  title: "Jo Wray — Obituary",
  description:
    "Beloved wife, mother, grandmother, and retired kindergarten teacher Velma Josephine (Jo) Wray (née Hart) of Hunt Valley, Maryland, passed away peacefully on November 2, 2026, after a brief illness.",
};

// Static page: no request-time data, so it prerenders at build. The text is
// the family's obituary, verbatim (the longer version from 2026-11-04); edit it
// here only when they change it. The words are unchanged by the two name links
// (Robert Wray, Tracy Gold) Rob asked for on 2026-11-06.
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
          Jo leaves behind her husband Richard Wray, her son{" "}
          <a href={ROB_URL} className={linkClass}>
            Robert Wray
          </a>{" "}
          and his wife,{" "}
          <a href={TRACY_URL} className={linkClass}>
            Tracy Gold
          </a>
          , and her grandchild, Ava Goldwray. She also leaves her sister Kay Bartholomew, brother-in-law Doug
          Bartholomew, and nephews Andrew, Daniel, and Paul.
        </p>
        <p>
          Growing up, much of Jo&rsquo;s life was centered around church activities. Her loving father
          Ivan was a chaplain in the Army, pastor, and special education teacher. Her loving mother
          Velma was an elementary school teacher, director of a preschool program, and an active
          church member.
        </p>
        <p>
          Jo learned scriptures and studied missions via the Southern Baptist church&rsquo;s Girls in
          Action program. She worked very hard and received a Queen Regent award. This included
          badges, a crown, a scepter and a cape. Jo loved being a queen!
        </p>
        <p>
          When she was very little, Jo even tried (and failed) to baptize the family cat! Jo loved to
          tease her sister by doing things like jumping out from behind the closet and telling stories
          about a black poodle and a scary house next door. As Jo grew, she had lively conversations
          with her parents, joyfully sparring over their strong opinions.
        </p>
        <p>
          In middle school, Jo attended the same school where her dad was teaching. Somehow, he ended
          up with Fred Flintstone as a nickname. When this frustrated Jo, she would playfully use her
          purse as a bopper box.
        </p>
        <p>
          Jo majored in early childhood education at Towson University, which was fate for more than
          just her career. Jo&rsquo;s former professor and friend Barbara Pour initiated a blind date
          with Richard Wray. Jo and her sister peeked through the curtains to check out this tall guy.
          55 years of marriage show that first date was quite a success!
        </p>
        <p>
          Richard became an important part of the family, joining in on Jo and Ivan&rsquo;s lively
          debates. Jo and Richard were married on Christmas Eve in 1971 after her first semester of
          teaching.
        </p>
        <p>
          Jo soon became a mother to Rob. With Richard&rsquo;s support, Jo continued teaching and
          gained her master&rsquo;s degree. During her career as a lower elementary school teacher, Jo
          loved nourishing and educating children. Some of her students reached out decades later to
          let her family know how much she meant to them as a teacher. Being a grandmother to Ava
          revived Jo&rsquo;s love of enriching children&rsquo;s lives with stories, games, crafts, and
          of course, many stuffed animals! Jo loved sewing, quilting, and even better, hunting a good
          bargain on craft supplies. If a craft involved a heart, Jo loved it even more because of her
          maiden name, Hart.
        </p>
        <p>
          Jo loved Christmas and supported Richard&rsquo;s retirement job as mall Santa. But you
          better not call her Mrs. Claus unless you wanted to get put on the naughty list! Jo Wray
          stuck to her own name and her own story.
        </p>
        <p>
          Richard, Jo, and Rob spent many summers in Lake George, New York, boating, hiking, and
          enjoying time with extended family. After retirement, Richard and Jo were able to spend
          even more time in Lake George, where Jo was active in the Ticonderoga First United
          Methodist Church.
        </p>
        <p>
          Richard and Jo spent the winters in their longtime home in Reisterstown, Maryland, before
          they moved into the Broadmead retirement community. Jo enjoyed keeping plants on the patio,
          attending lectures and community events, and shopping at the Amish market.
        </p>
        <p>
          Celebration of life arrangements are pending. In lieu of flowers, please send donations to
          the{" "}
          <a href="https://www.tifumc.com/" className={linkClass}>
            Ticonderoga First United Methodist Church
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
