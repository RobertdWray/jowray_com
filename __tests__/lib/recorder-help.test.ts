import { describe, expect, it } from "vitest";

import {
  detectPlatform,
  helpFor,
  problemFromError,
  type HelpPhase,
  type Platform,
  type RecorderProblem,
} from "@/lib/recorder-help";

const platforms: Platform[] = [
  "mac-chrome", "mac-safari", "mac-firefox", "ios", "android",
  "windows-chromium", "windows-edge", "windows-firefox", "other",
];
const problems: RecorderProblem[] = [
  "not-allowed", "not-found", "not-readable", "overconstrained",
  "security", "silent", "unsupported", "unknown",
];
const phases: HelpPhase[] = ["recording", "clip", "error"];

describe("problemFromError", () => {
  const names: [string, RecorderProblem][] = [
    ["NotAllowedError", "not-allowed"],
    ["NotFoundError", "not-found"],
    ["NotReadableError", "not-readable"],
    ["OverconstrainedError", "overconstrained"],
    ["SecurityError", "security"],
    ["PermissionDeniedError", "not-allowed"],
    ["DevicesNotFoundError", "not-found"],
    ["TrackStartError", "not-readable"],
    ["ConstraintNotSatisfiedError", "overconstrained"],
  ];

  it.each(names)("maps DOMException %s to %s", (name, expected) => {
    expect(problemFromError(new DOMException("m", name))).toBe(expected);
  });

  it.each(names)("maps a name-shaped object %s to %s", (name, expected) => {
    expect(problemFromError({ name })).toBe(expected);
  });

  it.each([
    new Error("x"), "string", undefined, null, 42, {}, { name: 42 },
    { name: "constructor" }, { name: "__proto__" }, { name: "AbortError" },
  ])("returns unknown for %s", (error) => {
    expect(problemFromError(error)).toBe("unknown");
  });
});

describe("detectPlatform", () => {
  const cases: { name: string; ua: string; touch?: number; platform: Platform }[] = [
    {
      name: "Mac Chrome",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      platform: "mac-chrome",
    },
    {
      name: "Mac Safari",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      platform: "mac-safari",
    },
    {
      name: "Mac Firefox",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
      platform: "mac-firefox",
    },
    {
      name: "iPhone Safari",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "ios",
    },
    {
      name: "iPad using a Macintosh UA",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      touch: 5,
      platform: "ios",
    },
    {
      name: "Mac with only one touch point",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      touch: 1,
      platform: "mac-safari",
    },
    {
      name: "CriOS with desktop UA",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 CriOS/130.0.0.0 Safari/604.1",
      platform: "ios",
    },
    {
      name: "FxiOS with desktop UA",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 FxiOS/132.0 Safari/605.1.15",
      platform: "ios",
    },
    {
      name: "Android Chrome",
      ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
      platform: "android",
    },
    {
      name: "Windows Edge before Chrome",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      platform: "windows-edge",
    },
    {
      name: "Windows Chrome",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      platform: "windows-chromium",
    },
    {
      name: "Windows Firefox",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
      platform: "windows-firefox",
    },
    {
      name: "Linux Chrome",
      ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      platform: "other",
    },
    { name: "unknown agent", ua: "", platform: "other" },
  ];

  it.each(cases)("chooses copy for $name", ({ ua, touch, platform }) => {
    expect(detectPlatform(ua, touch)).toBe(platform);
  });
});

describe("helpFor", () => {
  it.each(problems.flatMap((problem) => platforms.flatMap((platform) =>
    (problem === "silent" ? phases : ["clip"] as const).map((phase) => ({ problem, platform, phase })),
  )))(
    "gives complete help for $problem on $platform during $phase",
    ({ problem, platform, phase }) => {
      const help = helpFor(problem, platform, phase);
      expect(help.title.trim().length).toBeGreaterThan(0);
      expect(help.body.trim().length).toBeGreaterThan(0);
      expect(help.steps.length).toBeGreaterThan(0);
      for (const step of help.steps) {
        expect(step.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it.each(phases)("checks speech, device and Mac input volume before permissions during %s", (phase) => {
    const { title, body, steps } = helpFor("silent", "mac-chrome", phase);
    // Silent help now starts with actions available in the current phase.
    expect(steps[0]).toMatch(/normal volume.*watch the bars/);
    expect(steps[1]).toMatch(/different microphone.*list/i);
    expect(steps[1]).toMatch(/headset/);
    expect(steps[1]).toMatch(/virtual/);
    expect(steps[2]).toBe("Apple menu > System Settings > Sound > Input: choose the microphone and make sure Input volume is not at zero");
    const permissionIndex = steps.findIndex((step) => step.includes("Privacy & Security"));
    expect(permissionIndex).toBeGreaterThan(2);
    expect(`${title} ${body}`).not.toMatch(/permission|denied|blocked/i);
  });

  it("uses the live meter and asks to stop before changing microphone during recording", () => {
    const help = helpFor("silent", "mac-chrome", "recording");
    expect(help.title).toBe("We're not hearing anything");
    expect(help.body).toBe("The microphone may be quiet or the wrong one may be selected. Try these steps.");
    expect(help.steps[0]).toBe("Keep talking at your normal volume and watch the bars");
    expect(help.steps[1]).toBe("Stop, then pick a different microphone from the list if one is shown. A headset that is paired but idle, or a virtual input, can record nothing.");
  });

  it("asks to play the finished clip and record again before watching the bars", () => {
    const help = helpFor("silent", "mac-chrome", "clip");
    expect(help.title).toBe("This recording sounds silent");
    expect(help.body).toBe("We didn't hear anything while you were recording. You can send it anyway, or try these steps and record again.");
    expect(help.steps[0]).toBe("Play it back. If it is silent, press Record again, say something at your normal volume and watch the bars");
    expect(help.steps[1]).toBe("Pick a different microphone from the list if one is shown, then record again. A headset that is paired but idle, or a virtual input, can record nothing.");
    expect(help.steps.some((step) => step.startsWith("Stop, then"))).toBe(false);
  });

  it.each(platforms)("defaults to clip help for silence on %s", (platform) => {
    expect(helpFor("silent", platform)).toEqual(helpFor("silent", platform, "clip"));
  });

  it.each(platforms)("uses clip help for silence in the error phase on %s", (platform) => {
    expect(helpFor("silent", platform, "error")).toEqual(helpFor("silent", platform, "clip"));
  });

  it.each(problems.filter((problem) => problem !== "silent").flatMap((problem) =>
    platforms.map((platform) => ({ problem, platform })),
  ))("keeps $problem help identical across phases on $platform", ({ problem, platform }) => {
    const help = helpFor(problem, platform);
    for (const phase of phases) {
      expect(helpFor(problem, platform, phase)).toEqual(help);
    }
  });

  it.each([
    ["mac-chrome", "Google Chrome"],
    ["mac-safari", "Safari"],
    ["mac-firefox", "Firefox"],
  ] as const)("names the Mac browser in the OS permission path for %s", (platform, browser) => {
    expect(helpFor("not-allowed", platform).steps).toContain(
      `Choose Apple menu > System Settings, then click Privacy & Security in the sidebar. Click Microphone. Turn access to the microphone on for ${browser}.`,
    );
  });

  it.each(["mac-chrome", "windows-chromium"] as const)("gives Chrome's site permission path for %s", (platform) => {
    const { steps } = helpFor("not-allowed", platform);
    expect(steps).toContain('Open Chrome. At the top right, select More and then Settings. Select Privacy and security and then Site settings. Under "Permissions," select Microphone.');
    expect(steps).toContain("Or click the microphone icon at the right of the address bar.");
  });

  it("gives Safari's site permission path", () => {
    expect(helpFor("not-allowed", "mac-safari").steps).toContain(
      "In Safari, choose Safari > Settings, click Websites, then click Microphone. For jowray.com choose Allow.",
    );
  });

  it("includes all iOS permission routes", () => {
    const { steps } = helpFor("not-allowed", "ios");
    expect(steps).toContain("Go to Settings > Apps > Safari (or Chrome) > Microphone and choose Ask or Allow.");
    expect(steps).toContain("Or in Safari, tap the Page Menu button, tap Website Settings, then tap Microphone.");
    expect(steps).toContain("Go to Settings > Privacy & Security > Microphone and make sure your browser is turned on.");
  });

  it("gives the Android Chrome permission path", () => {
    expect(helpFor("not-allowed", "android").steps).toContain(
      "On your Android device, open Chrome. To the right of the address bar, tap More and then Settings. Tap Site settings and then Microphone. If you find jowray.com under Blocked, tap the site and then Allow.",
    );
  });

  it("uses Edge wording and its address-bar lock icon without Chrome instructions", () => {
    const help = helpFor("not-allowed", "windows-edge");
    expect(help.steps).toContain("Open Edge. Select Settings and more (…) > Settings > Cookies and site permissions > Microphone.");
    expect(help.steps.join(" ")).toMatch(/lock icon/);
    expect(JSON.stringify(help)).not.toContain("Chrome");
  });

  it.each(["windows-chromium", "windows-edge", "windows-firefox"] as const)("includes desktop microphone access on %s", (platform) => {
    expect(helpFor("not-allowed", platform).steps).toContain(
      "Select Start > Settings > Privacy & security > Microphone. Make sure Microphone access is on, Let apps access your microphone is on, and Let desktop apps access your microphone is on.",
    );
  });

  it.each(["mac-firefox", "windows-firefox"] as const)("gives Firefox's two permission routes on %s", (platform) => {
    const { steps } = helpFor("not-allowed", platform);
    expect(steps).toContain("Click the permissions icon at the left of the address bar and clear the Blocked status so Firefox asks again.");
    expect(steps).toContain("Or open Firefox Settings > Privacy & Security > Permissions > Microphone > Settings… and set jowray.com to Allow.");
  });

  it.each(["silent", "not-allowed"] as const)("reassures about saved words when %s help asks for a browser restart", (problem) => {
    for (const platform of ["mac-chrome", "mac-safari", "mac-firefox"] as const) {
      const { steps } = helpFor(problem, platform);
      const quitIndex = steps.indexOf("Quit and reopen the browser.");
      expect(quitIndex).toBeGreaterThan(-1);
      expect(steps[quitIndex + 1]).toBe("Your written words are kept on this device until you send them");
    }
  });

  it.each(platforms)("offers the file field when recording is unsupported on %s", (platform) => {
    const help = helpFor("unsupported", platform);
    expect(help.body).toBe("Recording isn't available in this browser. You can attach a voice memo with the file field instead.");
  });

  it.each(["windows-chromium", "windows-edge", "windows-firefox", "android"] as const)("never gives Mac System Settings for silence on %s", (platform) => {
    expect(JSON.stringify(helpFor("silent", platform))).not.toContain("System Settings");
  });

  it.each(["mac-chrome", "mac-safari", "mac-firefox", "ios"] as const)("never gives Windows Start settings for silence on %s", (platform) => {
    expect(JSON.stringify(helpFor("silent", platform))).not.toContain("Start >");
  });

  it.each(phases)("checks Windows input volume before microphone privacy during %s", (phase) => {
    const { steps } = helpFor("silent", "windows-chromium", phase);
    expect(steps[2]).toBe("Start > Settings > System > Sound > Input: choose the device and check its volume");
    expect(steps.findIndex((step) => step.includes("Privacy & security"))).toBeGreaterThan(2);
  });

  it.each(["ios", "android"] as const)("checks the microphone is uncovered and free on %s", (platform) => {
    expect(helpFor("silent", platform).steps[2]).toMatch(/covering.*microphone.*other app/i);
  });

  it("suggests plugging in a missing microphone or choosing it in sound settings", () => {
    const help = helpFor("not-found", "mac-chrome");
    expect(help.body).toMatch(/no microphone/i);
    expect(help.steps.join(" ")).toMatch(/plug.*microphone/i);
    expect(help.steps.join(" ")).toContain("Sound > Input");
  });

  it("suggests closing a video call app when the microphone cannot start", () => {
    const help = helpFor("not-readable", "other");
    expect(help.body).toMatch(/another app.*may/i);
    expect(help.steps.join(" ")).toMatch(/Zoom/);
    expect(help.steps.join(" ")).toMatch(/close.*try again/i);
  });

  it("asks for another input when the chosen microphone is unavailable", () => {
    const help = helpFor("overconstrained", "other");
    expect(help.body).toMatch(/no longer available/i);
    expect(help.steps.join(" ")).toMatch(/another microphone.*list/i);
  });

  it("offers a file for website-level microphone security restrictions", () => {
    const help = helpFor("security", "other");
    expect(help.body).toMatch(/microphone access switched off for websites/i);
    expect(help.steps.join(" ")).toMatch(/file field/);
  });

  it("offers a retry and file for an unknown recording error", () => {
    const help = helpFor("unknown", "other");
    expect(help.title).toBe("Something stopped the recording");
    expect(help.steps.join(" ")).toMatch(/try again/i);
    expect(help.steps.join(" ")).toMatch(/file field/);
  });
});
