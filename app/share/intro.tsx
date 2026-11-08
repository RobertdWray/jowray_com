export function Intro({ greeting }: { greeting?: string }) {
  return (
    <>
      {greeting && <p className="font-display text-lead">{greeting}</p>}
      <h1 className="font-display text-h2-sm font-bold sm:text-h2">Write it down here.</h1>
      <p className="text-body">
        Tell us who you are, and roughly when the memory is from if you know — &quot;her classroom, 1970s&quot; or
        {" "}&quot;Christmas 2019&quot; is plenty. Then tell the story the way you&apos;d tell it at her kitchen table, or add a
        photo, a video or a voice recording.
      </p>
    </>
  );
}
