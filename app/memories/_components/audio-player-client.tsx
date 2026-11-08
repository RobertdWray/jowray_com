"use client";

import { useRef, useState, type SyntheticEvent } from "react";

import { playedBars } from "@/lib/memories/client-logic";
import { clockText, durationText } from "@/lib/memories/format";
import { reportClientError } from "@/lib/sentry/report";

/** Play a recording on request, keeping the large control and waveform in sync with native audio controls. */
export function AudioPlayer({
  src,
  mimeType,
  durationSeconds,
  bars,
}: {
  src: string;
  mimeType: string;
  durationSeconds: number | null;
  bars: number[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [measuredDuration, setMeasuredDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const total = measuredDuration ?? durationSeconds;
  const played = playedBars(current, total, bars.length);
  const duration = durationText(durationSeconds);

  function updateDuration(event: SyntheticEvent<HTMLAudioElement>) {
    const value = event.currentTarget.duration;
    setMeasuredDuration(Number.isFinite(value) ? value : null);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch (error) {
      if (audioRef.current === audio) {
        setPlaying(false);
      }
      reportClientError(error, { surface: "memories", step: "play" });
    }
  }

  return (
    <section aria-label="The recording" className="flex flex-col gap-4 rounded-[16px] border-[3px] border-dashed border-periwinkle bg-paper p-[18px] shadow-card">
      <div aria-hidden="true" className="flex h-[72px] items-center gap-[3px] overflow-hidden">
        {bars.map((height, index) => (
          <span
            key={index}
            style={{ height }}
            className={`min-w-[3px] flex-1 rounded-[2px] ${index < played ? "bg-periwinkle-deep" : "bg-periwinkle"}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-small font-bold text-walnut-soft">
        <span>{clockText(current)}</span>
        {total !== null && <span>{clockText(total)}</span>}
      </div>
      <button
        type="button"
        onClick={togglePlayback}
        className="min-h-tap-lg w-full rounded-button bg-jo-red text-body font-bold text-white shadow-button-red flex items-center justify-center gap-3"
      >
        <svg width={26} height={26} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
          {playing ? (
            <>
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </>
          ) : <path d="M8 5.5v13l11-6.5z" />}
        </svg>
        {playing ? "Pause" : (duration ? `Listen · ${duration}` : "Listen")}
      </button>
      <audio
        key={src}
        ref={audioRef}
        controls
        preload="metadata"
        className="w-full"
        onLoadStart={() => {
          setCurrent(0);
          setMeasuredDuration(null);
          setPlaying(false);
        }}
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        <source src={src} type={mimeType} />
      </audio>
      <p className="text-center text-small text-walnut-soft">Nothing plays until you press it.</p>
    </section>
  );
}
