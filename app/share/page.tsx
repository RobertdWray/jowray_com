import { ShareForm } from "./share-form";

// The Server Functions in ./actions.ts inherit this page's limit; it bounds
// finalizeUpload(), completeSubmission() (the receipt send, including its
// bounded wait for the outbound lock) and the after() work they schedule. The page reads no request data, so it
// stays prerendered; the phone/computer split is CSS alone (D1).
export const maxDuration = 120;

function Intro() {
  return (
    <>
      <h1 className="font-display text-h2-sm font-bold sm:text-h2">Write it down here.</h1>
      <p className="text-body">
        Tell us who you are, and roughly when the memory is from if you know — &quot;her classroom, 1970s&quot; or
        {" "}&quot;Christmas 2019&quot; is plenty. Then tell the story the way you&apos;d tell it at her kitchen table, or add a
        photo, a video or a voice recording.
      </p>
    </>
  );
}

export default function SharePage() {
  return (
    <main className="flex flex-1 flex-col">
      <ShareForm intro={<Intro />} />
    </main>
  );
}
