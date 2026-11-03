import { ShareForm } from "./share-form";

// The Server Functions in ./actions.ts inherit this page's limit; it bounds
// finalizeUpload() and the inline checksum in after().
export const maxDuration = 120;

export default function SharePage() {
  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Share a memory</h1>
      <p>A voice recording, a video, a photo, or a few words. Everything is kept exactly as you send it.</p>
      <ShareForm />
    </main>
  );
}
