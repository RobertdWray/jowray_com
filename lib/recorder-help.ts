export type RecorderProblem =
  | "not-allowed"
  | "not-found"
  | "not-readable"
  | "overconstrained"
  | "security"
  | "silent"
  | "unsupported"
  | "unknown";

export type Platform =
  | "mac-chrome"
  | "mac-safari"
  | "mac-firefox"
  | "ios"
  | "android"
  | "windows-chromium"
  | "windows-edge"
  | "windows-firefox"
  | "other";

/** Recognise modern and legacy error names without depending on browser objects. */
export function problemFromError(error: unknown): RecorderProblem {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return "unknown";
  }
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "not-allowed";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "not-found";
    case "NotReadableError":
    case "TrackStartError":
      return "not-readable";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "overconstrained";
    case "SecurityError":
      return "security";
    default:
      return "unknown";
  }
}

/** Choose familiar help wording from the UA; this never determines recording support. */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (
    /iPhone|iPad|iPod|CriOS|FxiOS/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/Android/i.test(userAgent)) {
    return "android";
  }
  if (/Windows/i.test(userAgent)) {
    if (/Edg\//i.test(userAgent)) {
      return "windows-edge";
    }
    if (/Firefox\//i.test(userAgent)) {
      return "windows-firefox";
    }
    if (/Chrome\/|Chromium\//i.test(userAgent)) {
      return "windows-chromium";
    }
  }
  if (/Macintosh/i.test(userAgent)) {
    if (/Firefox\//i.test(userAgent)) {
      return "mac-firefox";
    }
    if (/Chrome\/|Chromium\//i.test(userAgent)) {
      return "mac-chrome";
    }
    if (/Safari\//i.test(userAgent)) {
      return "mac-safari";
    }
  }
  return "other";
}

export interface RecorderHelp {
  title: string;
  body: string;
  steps: string[];
}

const CHROME_PERMISSION_STEPS = [
  'Open Chrome. At the top right, select More and then Settings. Select Privacy and security and then Site settings. Under "Permissions," select Microphone.',
  "Or click the microphone icon at the right of the address bar.",
];
const FIREFOX_PERMISSION_STEPS = [
  "Click the permissions icon at the left of the address bar and clear the Blocked status so Firefox asks again.",
  "Or open Firefox Settings > Privacy & Security > Permissions > Microphone > Settings… and set jowray.com to Allow.",
];
const WINDOWS_PERMISSION_STEP =
  "Select Start > Settings > Privacy & security > Microphone. Make sure Microphone access is on, Let apps access your microphone is on, and Let desktop apps access your microphone is on.";

function macPermissionSteps(browser: string): string[] {
  return [
    `Choose Apple menu > System Settings, then click Privacy & Security in the sidebar. Click Microphone. Turn access to the microphone on for ${browser}.`,
    "Quit and reopen the browser.",
    "Your written words are kept on this device until you send them",
  ];
}

function permissionStepsFor(platform: Platform): string[] {
  switch (platform) {
    case "mac-chrome":
      return [...macPermissionSteps("Google Chrome"), ...CHROME_PERMISSION_STEPS];
    case "mac-safari":
      return [
        ...macPermissionSteps("Safari"),
        "In Safari, choose Safari > Settings, click Websites, then click Microphone. For jowray.com choose Allow.",
      ];
    case "mac-firefox":
      return [...macPermissionSteps("Firefox"), ...FIREFOX_PERMISSION_STEPS];
    case "windows-chromium":
      return [WINDOWS_PERMISSION_STEP, ...CHROME_PERMISSION_STEPS];
    case "windows-edge":
      return [
        WINDOWS_PERMISSION_STEP,
        "Open Edge. Select Settings and more (…) > Settings > Cookies and site permissions > Microphone.",
        "Or click the lock icon at the left of the address bar and allow microphone access for jowray.com.",
      ];
    case "windows-firefox":
      return [WINDOWS_PERMISSION_STEP, ...FIREFOX_PERMISSION_STEPS];
    case "ios":
      return [
        "Go to Settings > Apps > Safari (or Chrome) > Microphone and choose Ask or Allow.",
        "Or in Safari, tap the Page Menu button, tap Website Settings, then tap Microphone.",
        "Go to Settings > Privacy & Security > Microphone and make sure your browser is turned on.",
      ];
    case "android":
      return [
        "On your Android device, open Chrome. To the right of the address bar, tap More and then Settings. Tap Site settings and then Microphone. If you find jowray.com under Blocked, tap the site and then Allow.",
      ];
    case "other":
      return ["Open your browser's website settings and allow microphone access for jowray.com."];
  }
}

function inputCheckFor(platform: Platform): string {
  switch (platform) {
    case "mac-chrome":
    case "mac-safari":
    case "mac-firefox":
      return "Apple menu > System Settings > Sound > Input: choose the microphone and make sure Input volume is not at zero";
    case "windows-chromium":
    case "windows-edge":
    case "windows-firefox":
      return "Start > Settings > System > Sound > Input: choose the device and check its volume";
    case "ios":
    case "android":
      return "Make sure nothing is covering the microphone and no other app is using it.";
    case "other":
      return "Open your device's sound settings, choose the microphone and check its input volume.";
  }
}

/** Give practical next steps, checking silent inputs before suggesting permission changes. */
export function helpFor(problem: RecorderProblem, platform: Platform): RecorderHelp {
  switch (problem) {
    case "silent":
      return {
        title: "We're not hearing anything",
        body: "The microphone may be quiet or the wrong one may be selected. Try these steps.",
        steps: [
          "Say something at your normal volume and watch the bars",
          "Pick a different microphone from the list if one is shown. A headset that is paired but idle, or a virtual input, can record nothing.",
          inputCheckFor(platform),
          ...permissionStepsFor(platform),
        ],
      };
    case "not-allowed":
      return {
        title: "Allow microphone access",
        body: "Allow microphone access for your browser and jowray.com. Then try again.",
        steps: permissionStepsFor(platform),
      };
    case "not-found":
      return {
        title: "We couldn't find a microphone",
        body: "No microphone was found. Connect one or choose one in your sound settings.",
        steps: ["Plug in a microphone if you have one, then try again.", inputCheckFor(platform)],
      };
    case "not-readable":
      return {
        title: "The microphone couldn't start",
        body: "Another app may be using the microphone.",
        steps: ["Close any video call app, such as Zoom, and try again."],
      };
    case "overconstrained":
      return {
        title: "Choose another microphone",
        body: "The microphone you chose is no longer available.",
        steps: ["Pick another microphone from the list and try again."],
      };
    case "security":
      return {
        title: "Microphone access is unavailable",
        body: "This browser has microphone access switched off for websites.",
        steps: ["You can attach a voice memo with the file field instead."],
      };
    case "unsupported":
      return {
        title: "Recording isn't available",
        body: "Recording isn't available in this browser. You can attach a voice memo with the file field instead.",
        steps: ["Record a voice memo on your device, then attach it with the file field."],
      };
    case "unknown":
      return {
        title: "Something stopped the recording",
        body: "You can try again or attach a voice memo you have already recorded.",
        steps: ["Try again.", "Or attach a voice memo with the file field instead."],
      };
  }
}
