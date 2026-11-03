import Link from "next/link";

// Static landing page for the one Phase 1 memorial. The obituary and the
// memory wall come in a later phase; for now the page explains what this is
// and sends visitors to /share.
export default function HomePage() {
  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide">In memory of</p>
        <h1 className="text-3xl font-semibold">Jo Wray</h1>
        <p>Velma Josephine Wray, née Hart. Wife, mother, grandmother, kindergarten teacher.</p>
      </header>
      <section className="space-y-3">
        <p>
          If Jo was part of your life, her family would love to hear your memory of her: a story in your own words, a
          photo, a video, or a voice recording. Everything is kept exactly as you send it.
        </p>
        <p>
          <Link href="/share" className="inline-block rounded bg-black px-4 py-2 text-white">
            Share a memory of Jo
          </Link>
        </p>
      </section>
    </main>
  );
}
