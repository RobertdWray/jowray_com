"use client";

import Image from "next/image";
import { useId, useRef, useState, type ReactNode } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";

import { SecondaryButton } from "../_components/buttons";

// One README diagram that fits its card, with zoom, pan and full-screen controls (Rob, 2026-11-06; the control set
// copies the TrayVerify investors slide [C16]). Plan: docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md.
//
// Inline, scale 1 is "fits the card": the page is never wider than the screen. The inline view never takes the page
// away from the reader: the wheel zooms only with Ctrl or ⌘ held, and dragging pans only once zoomed in, so at fit
// size a swipe or a wheel scrolls the page as usual [C18]. "Full screen" is a full-window <dialog>, not the
// Fullscreen API, which iPhones lack [C22]; there every gesture and the keyboard work, and arrow buttons give a way
// to pan without dragging (WCAG 2.5.7) [C21]. react-zoom-pan-pinch ships without "use client", so it is imported
// only here [C19].

const MAX_SCALE = 8; // The library's default; enough to reach natural size (17px+ text) from a 358px phone card.
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

const toolButtonClass =
  "inline-flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-input border-[3px] border-dashed border-wood bg-paper px-4 py-2 text-label font-bold text-walnut disabled:cursor-not-allowed disabled:opacity-50";

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
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  function openFullScreen() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }
    dialog.showModal();
    // The title takes focus first (WAI-ARIA APG dialog pattern) [C8]; the viewer mounts on this render, while the
    // dialog is visible, so it measures the real window.
    titleRef.current?.focus();
    setFullOpen(true);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TransformWrapper
        maxScale={MAX_SCALE}
        wheel={{ activationKeys: withCtrlOrCmd }}
        panning={{ disabled: !zoomed }}
        onTransform={(_ref, state) => setZoomed(state.scale > 1.001)}
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

      {/* Full-window: Preflight zeroes the margin and the UA max sizes are dropped, so it fills the screen [C9]. */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setFullOpen(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-paper p-0 text-left text-walnut backdrop:bg-walnut/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b-[3px] border-wood-light px-4 py-3 sm:px-6">
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="mr-auto font-display text-[24px] font-bold leading-[1.2] focus:outline-none"
            >
              {heading}
            </h2>
            <SecondaryButton onClick={() => dialogRef.current?.close()} className="min-h-tap py-2">
              Close
            </SecondaryButton>
          </div>
          {fullOpen && (
            <TransformWrapper maxScale={MAX_SCALE} centerOnInit keyboard={{ disabled: false }}>
              <div className="px-4 py-3 sm:px-6">
                <Toolbar heading={heading} zoomed withArrows />
              </div>
              <div className="relative min-h-0 flex-1">
                <TransformComponent
                  wrapperStyle={fillBox}
                  contentStyle={centreContent}
                  wrapperProps={{
                    role: "group",
                    "aria-label": `${heading} diagram. Arrow keys move it; plus and minus zoom.`,
                  }}
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
            </TransformWrapper>
          )}
        </div>
      </dialog>
    </div>
  );
}

function Toolbar({
  heading,
  zoomed,
  withArrows = false,
  children,
}: {
  heading: string;
  zoomed: boolean;
  withArrows?: boolean;
  children?: ReactNode;
}) {
  const { zoomIn, zoomOut, resetTransform, panBy } = useControls();
  // panBy moves the content: a positive x shifts it right, which shows more of its left side [C18].
  const arrows = [
    { label: "Left", icon: "left", dx: PAN_STEP, dy: 0 },
    { label: "Up", icon: "up", dx: 0, dy: PAN_STEP },
    { label: "Down", icon: "down", dx: 0, dy: -PAN_STEP },
    { label: "Right", icon: "right", dx: -PAN_STEP, dy: 0 },
  ] as const;
  return (
    <div role="toolbar" aria-label={`${heading} diagram controls`} className="flex flex-wrap gap-2">
      <button type="button" aria-label={`Zoom in on ${heading}`} onClick={() => zoomIn()} className={toolButtonClass}>
        <Icon name="plus" />
        Zoom in
      </button>
      <button
        type="button"
        aria-label={`Zoom out of ${heading}`}
        onClick={() => zoomOut()}
        disabled={!zoomed}
        className={toolButtonClass}
      >
        <Icon name="minus" />
        Zoom out
      </button>
      <button
        type="button"
        aria-label={`Fit ${heading} to the screen`}
        onClick={() => resetTransform()}
        className={toolButtonClass}
      >
        <Icon name="fit" />
        Fit
      </button>
      {withArrows &&
        arrows.map((arrow) => (
          <button
            key={arrow.label}
            type="button"
            aria-label={`Move the view ${arrow.label.toLowerCase()}`}
            onClick={() => panBy(arrow.dx, arrow.dy)}
            className={toolButtonClass}
          >
            <Icon name={arrow.icon} />
            <span className="sr-only sm:not-sr-only">{arrow.label}</span>
          </button>
        ))}
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
