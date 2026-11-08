import { Intro } from "./intro";
import { ShareForm } from "./share-form";

// The Server Functions in ./actions.ts inherit this page's limit; it bounds
// finalizeUpload(), completeSubmission() (the receipt send, including its
// bounded wait for the outbound lock) and the after() work they schedule.
// Intro now lives in ./intro.tsx, shared with the invite page. This page reads
// no request data and stays prerendered; the phone/computer split is CSS alone (D1).
export const maxDuration = 120;

export default function SharePage() {
  return (
    <main className="flex flex-1 flex-col">
      <ShareForm intro={<Intro />} />
    </main>
  );
}
