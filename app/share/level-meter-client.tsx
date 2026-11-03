"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { levelToBarHeight, SILENCE_FLOOR_DBFS, type Hearing } from "@/lib/audio-level";
import { formatDuration } from "@/lib/format-duration";

import { LEVEL_HISTORY, type AudioRecorder } from "./recorder";

const METER_HEIGHT = 56; // min-h-tap
const DOT = 10;

/** Theme colours for the canvas; Tailwind only emits variables that utilities use, hence the fallbacks. */
const FALLBACK = { loud: "#3f5f94", quiet: "#e9d9c0", dot: "#c8102e" };

function themeColours(): typeof FALLBACK {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    loud: read("--color-periwinkle-deep", FALLBACK.loud),
    quiet: read("--color-wood-light", FALLBACK.quiet),
    dot: read("--color-jo-red", FALLBACK.dot),
  };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

function hearingText(hearing: Hearing, interrupted: boolean): string {
  if (interrupted) {
    return "Recording paused by your phone";
  }
  switch (hearing) {
    case "hearing":
      return "Hearing you";
    case "silent":
      return "We're not hearing anything";
    case "listening":
    case "unknown":
      return "Listening…";
  }
}

/** Keeps the backing store at device resolution so bars stay crisp on phones and Retina Macs. */
function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(METER_HEIGHT * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function LevelMeter({
  recorder,
  hearing,
  interrupted,
  elapsedSeconds,
  reducedMotion,
}: {
  recorder: AudioRecorder;
  hearing: Hearing;
  interrupted: boolean;
  elapsedSeconds: number;
  reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const colours = themeColours();
    const levels = new Float32Array(LEVEL_HISTORY);
    const observer = new ResizeObserver(() => fitCanvas(canvas));
    observer.observe(canvas);

    // Motion: a scrolling bar waveform, newest at the right, drawn each frame.
    const drawBars = () => {
      const ctx = fitCanvas(canvas);
      if (!ctx) {
        return;
      }
      const width = canvas.getBoundingClientRect().width;
      ctx.clearRect(0, 0, width, METER_HEIGHT);
      const head = recorder.readLevels(levels);
      const slot = width / LEVEL_HISTORY;
      const barWidth = Math.max(2, slot * 0.6);
      for (let i = 0; i < LEVEL_HISTORY; i += 1) {
        const dbfs = levels[(head + i) % LEVEL_HISTORY] ?? SILENCE_FLOOR_DBFS;
        const h = Math.max(2, levelToBarHeight(dbfs) * (METER_HEIGHT - 4));
        ctx.fillStyle = levelToBarHeight(dbfs) > 0 ? colours.loud : colours.quiet;
        const x = i * slot + (slot - barWidth) / 2;
        ctx.fillRect(x, (METER_HEIGHT - h) / 2, barWidth, h);
      }
    };

    // Reduced motion: one horizontal level bar, redrawn only when a tick arrives.
    const drawBar = (dbfs: number) => {
      const ctx = fitCanvas(canvas);
      if (!ctx) {
        return;
      }
      const width = canvas.getBoundingClientRect().width;
      ctx.clearRect(0, 0, width, METER_HEIGHT);
      ctx.fillStyle = colours.quiet;
      ctx.fillRect(0, METER_HEIGHT / 2 - 6, width, 12);
      const level = levelToBarHeight(dbfs);
      if (level > 0) {
        ctx.fillStyle = colours.loud;
        ctx.fillRect(0, METER_HEIGHT / 2 - 6, width * level, 12);
      }
    };

    if (reducedMotion) {
      drawBar(SILENCE_FLOOR_DBFS);
      const off = recorder.onLevel(drawBar);
      return () => {
        off();
        observer.disconnect();
      };
    }
    let frame = 0;
    const loop = () => {
      drawBars();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [recorder, reducedMotion]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`inline-block flex-none rounded-full bg-jo-red ${interrupted ? "" : "motion-safe:animate-pulse"}`}
          style={{ width: DOT, height: DOT }}
        />
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Microphone level"
          className="block min-w-0 flex-1 rounded-input bg-muslin"
          style={{ height: METER_HEIGHT }}
        />
        {/* The ticking timer lives outside the live region so it is not announced every second. */}
        <span className="flex-none tabular-nums text-body font-bold text-walnut">{formatDuration(elapsedSeconds * 1000)}</span>
      </div>
      <p aria-live="polite" className="text-small text-walnut-soft">
        {hearingText(hearing, interrupted)}
      </p>
    </div>
  );
}
