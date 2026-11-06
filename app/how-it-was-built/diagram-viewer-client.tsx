"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";

import { SecondaryButton } from "../_components/buttons";

// One README diagram that fits its card, with zoom, pan and full-screen controls (Rob, 2026-11-06; the control set
// copies the TrayVerify investors slide [C16]). Plan: docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md.
//
// Inline, scale 1 is "fits the card": the page is never wider than the screen. The inline view never takes the page
// away from the reader: the wheel zooms only with Ctrl or ⌘ held, dragging pans only once zoomed in, and a double-tap
// does nothing (one by accident while scrolling would zoom the card and turn the next swipes into panning), so at fit
// size a swipe or a wheel scrolls the page as usual [C18]. "Full screen" is a full-window <dialog>, not the
// Fullscreen API, which iPhones lack [C22]; there every gesture and the keyboard work. Both views have arrow buttons,
// a way to pan without dragging (WCAG 2.5.7) [C21]. react-zoom-pan-pinch ships without "use client", so it is
// imported only here [C19].

// Inline cap. The narrowest card is 282px (a 320px phone), and the widest diagram (2174px) needs 7.7× there to reach
// its natural size, where the generator guarantees 17px+ text. Full screen works its cap out from the window instead.
const INLINE_MAX_SCALE = 8;
// Full screen may zoom to twice the natural size.
const NATURAL_HEADROOM = 2;
const PAN_STEP = 120;

// Inline, the wheel zooms only while Ctrl or ⌘ is held. A plain list of activation keys means "all of them at
// once" (the library checks keys.every), so the either-or test is the function form of activationKeys [C18].
const withCtrlOrCmd = (keys: string[]) => keys.includes("Control") || keys.includes("Meta");

// The library's stylesheet sizes its wrapper and content to fit-content and is injected after ours, so the sizes
// that must win are inline styles.
const fillWidth = { width: "100%" } as const;
const fillBox = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;
const centreContent = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

// aria-disabled rather than disabled: a disabled button drops keyboard focus to <body> the moment it disables itself
// (Zoom out or Fit reaching fit size), and a screen-reader user loses their place.
const toolButtonBase =
  "inline-flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-input border-[3px] border-dashed border-wood bg-paper py-2 text-label font-bold text-walnut aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const toolButtonClass = `${toolButtonBase} px-4`;
// Icon only: a 20px icon, 9px padding and 3px borders make 44px, DESIGN.md's touch minimum.
const iconButtonClass = `${toolButtonBase} px-[9px]`;

// panBy moves the content: a positive x shifts it right, which shows more of its left side [C18].
const ARROWS = [
  { direction: "left", dx: PAN_STEP, dy: 0 },
  { direction: "up", dx: 0, dy: PAN_STEP },
  { direction: "down", dx: 0, dy: -PAN_STEP },
  { direction: "right", dx: -PAN_STEP, dy: 0 },
] as const;

const isZoomed = (scale: number) => scale > 1.001;

interface DiagramViewerProps {
  heading: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  /** The visible description under the figure title, linked to the inline image. */
  descriptionId: string;
}

export function DiagramViewer({ heading, src, width, height, alt, descriptionId }: DiagramViewerProps) {
  const [zoomed, setZoomed] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function openFullScreen() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }
    dialog.showModal();
    // The view mounts on this render, inside the now-visible dialog, so it measures the real window.
    setFullOpen(true);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TransformWrapper
        maxScale={INLINE_MAX_SCALE}
        wheel={{ activationKeys: withCtrlOrCmd }}
        panning={{ disabled: !zoomed }}
        doubleClick={{ disabled: true }}
        onTransform={(_ref, state) => setZoomed(isZoomed(state.scale))}
      >
        <Toolbar heading={heading} zoomed={zoomed}>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`Full screen: ${heading}`}
            onClick={openFullScreen}
            className={toolButtonClass}
          >
            <Icon name="expand" />
            Full screen
          </button>
        </Toolbar>
        {/* The card clips the zoomed image to its rounded corners. */}
        <div className="overflow-hidden rounded-card border-[3px] border-wood-light bg-paper shadow-card">
          <TransformComponent wrapperStyle={fillWidth} contentStyle={fillWidth}>
            <Image
              src={src}
              width={width}
              height={height}
              alt={alt}
              aria-describedby={descriptionId}
              unoptimized
              draggable={false}
              className="block h-auto w-full"
            />
          </TransformComponent>
        </div>
      </TransformWrapper>

      {/* Full-window: Preflight zeroes the margin and the UA max sizes are dropped, so it fills the screen [C9].
          w-full, not w-screen: a modal dialog is position: fixed, so 100% is the window without a scrollbar, while
          100vw in Safari and Firefox includes the classic scrollbar gutter the open dialog keeps (globals.css) and
          would push Close about 15px past the right edge. */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setFullOpen(false)}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-paper p-0 text-left text-walnut backdrop:bg-walnut/50"
      >
        {fullOpen && (
          <FullScreenView
            heading={heading}
            src={src}
            width={width}
            height={height}
            alt={alt}
            titleId={titleId}
            onClose={() => dialogRef.current?.close()}
          />
        )}
      </dialog>
    </div>
  );
}

function FullScreenView({
  heading,
  src,
  width,
  height,
  alt,
  titleId,
  onClose,
}: Omit<DiagramViewerProps, "descriptionId"> & { titleId: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const [maxScale, setMaxScale] = useState(INLINE_MAX_SCALE);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  // The title takes focus first (WAI-ARIA APG dialog pattern) [C8].
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // At scale 1 the image is fitted into the canvas by CSS, so reaching its natural size takes 1 / (fitted share).
  // On a landscape phone that is more than 10×; recomputed whenever the canvas changes size (rotation, resizing).
  // ResizeObserver reports once as soon as it starts observing, which gives the first measurement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const fitted = Math.min(1, entry.contentRect.width / width, entry.contentRect.height / height);
      if (fitted > 0) {
        setMaxScale(Math.max(INLINE_MAX_SCALE, NATURAL_HEADROOM / fitted));
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [width, height]);

  return (
    <TransformWrapper
      maxScale={maxScale}
      centerOnInit
      keyboard={{ disabled: false }}
      onTransform={(_ref, state) => setZoomed(isZoomed(state.scale))}
    >
      <div className="flex h-full flex-col">
        {/* One row from 640px up (a landscape phone included), so a short screen keeps its height for the diagram;
            on a portrait phone the controls take a second row under the title and Close. */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-b-[3px] border-wood-light px-4 py-2 [grid-template-areas:'title_close'_'tools_tools'] sm:grid-cols-[1fr_auto_auto] sm:px-6 sm:[grid-template-areas:'title_tools_close']">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-[22px] font-bold leading-[1.2] [grid-area:title] focus:outline-none"
          >
            {heading}
          </h2>
          <div className="[grid-area:tools]">
            <Toolbar heading={heading} zoomed={zoomed} compact />
          </div>
          <SecondaryButton onClick={onClose} className="min-h-tap py-2 [grid-area:close]">
            Close
          </SecondaryButton>
        </div>
        <span id={hintId} className="sr-only">
          Arrow keys move the diagram; plus and minus zoom.
        </span>
        <div ref={canvasRef} className="relative min-h-0 flex-1">
          {/* The wrapper fills the canvas, so its focus ring is drawn inside it, where nothing clips it. */}
          <TransformComponent
            wrapperStyle={fillBox}
            contentStyle={centreContent}
            wrapperClass="focus-visible:-outline-offset-4"
            wrapperProps={{ role: "group", "aria-label": `${heading} diagram`, "aria-describedby": hintId }}
          >
            <Image
              src={src}
              width={width}
              height={height}
              alt={alt}
              unoptimized
              draggable={false}
              className="block h-auto max-h-full w-auto max-w-full"
            />
          </TransformComponent>
        </div>
      </div>
    </TransformWrapper>
  );
}

function Toolbar({
  heading,
  zoomed,
  compact = false,
  children,
}: {
  heading: string;
  zoomed: boolean;
  /** Icon-only zoom buttons on narrow or short screens (the `narrow` variant), to leave room for the diagram. */
  compact?: boolean;
  children?: ReactNode;
}) {
  const { zoomIn, zoomOut, resetTransform, panBy } = useControls();
  // Compact, every control is a 44px icon button, so all seven fit one row on a 390px phone.
  const buttonClass = compact ? `${toolButtonClass} narrow:px-[9px]` : toolButtonClass;
  const labelClass = compact ? "narrow:sr-only" : undefined;
  const gapClass = compact ? "gap-2 narrow:gap-1.5" : "gap-2";
  // Zoom out, Fit and the arrows have nothing to do at fit size: they say so and ignore the press.
  const whenZoomed = (action: () => Promise<void>) => () => {
    if (zoomed) {
      void action();
    }
  };
  // A labelled group, not role="toolbar": a toolbar promises arrow-key movement between its buttons.
  return (
    <div role="group" aria-label={`${heading} diagram controls`} className={`flex flex-wrap ${gapClass}`}>
      <button
        type="button"
        aria-label={`Zoom in on ${heading}`}
        onClick={() => void zoomIn()}
        className={buttonClass}
      >
        <Icon name="plus" />
        <span className={labelClass}>Zoom in</span>
      </button>
      <button
        type="button"
        aria-label={`Zoom out of ${heading}`}
        aria-disabled={!zoomed}
        onClick={whenZoomed(() => zoomOut())}
        className={buttonClass}
      >
        <Icon name="minus" />
        <span className={labelClass}>Zoom out</span>
      </button>
      <button
        type="button"
        aria-label={`Fit ${heading} to the screen`}
        aria-disabled={!zoomed}
        onClick={whenZoomed(() => resetTransform())}
        className={buttonClass}
      >
        <Icon name="fit" />
        <span className={labelClass}>Fit</span>
      </button>
      {/* The four arrows stay together when the row wraps. */}
      <div className={`flex ${gapClass}`}>
        {ARROWS.map((arrow) => (
          <button
            key={arrow.direction}
            type="button"
            aria-label={`Move the ${heading} view ${arrow.direction}`}
            aria-disabled={!zoomed}
            onClick={whenZoomed(() => panBy(arrow.dx, arrow.dy))}
            className={iconButtonClass}
          >
            <Icon name={arrow.direction} />
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

const ICON_PATHS = {
  plus: "M10 4v12M4 10h12",
  minus: "M4 10h12",
  fit: "M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4",
  expand: "M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6",
  left: "M12 4l-6 6 6 6",
  right: "M8 4l6 6-6 6",
  up: "M4 12l6-6 6 6",
  down: "M4 8l6 6 6-6",
} as const;

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
