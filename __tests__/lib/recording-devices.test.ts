import { describe, expect, it } from "vitest";

import {
  audioConstraintsFor,
  audioInputsFor,
  describeActiveInput,
  resolveSelectedDevice,
  shouldShowPicker,
} from "@/lib/recording-devices";

const builtIn = { deviceId: "built-in", label: "Built-in microphone", groupId: "internal" };
const headset = { deviceId: "headset", label: "Headset microphone", groupId: "usb" };

describe("audioInputsFor", () => {
  it("keeps labelled audio inputs only and returns just their input fields", () => {
    expect(audioInputsFor([
      { kind: "videoinput", deviceId: "camera", label: "Camera", groupId: "internal" },
      { kind: "audiooutput", deviceId: "speaker", label: "Speaker", groupId: "internal" },
      { kind: "audioinput", deviceId: "hidden", label: "", groupId: "usb" },
      { kind: "audioinput", ...builtIn },
    ])).toStrictEqual([builtIn]);
  });

  it("drops default and communications aliases when a real input shares their group", () => {
    expect(audioInputsFor([
      { kind: "audioinput", ...builtIn, deviceId: "default" },
      { kind: "audioinput", ...builtIn, deviceId: "communications" },
      { kind: "audioinput", ...builtIn },
    ])).toStrictEqual([builtIn]);
  });

  it.each(["default", "communications"])("keeps a lone %s input", (deviceId) => {
    const input = { ...builtIn, deviceId };
    expect(audioInputsFor([{ kind: "audioinput", ...input }])).toStrictEqual([input]);
  });

  it("preserves the order of distinct inputs", () => {
    expect(audioInputsFor([
      { kind: "audioinput", ...headset },
      { kind: "audioinput", ...builtIn, deviceId: "default" },
      { kind: "audioinput", ...builtIn },
    ])).toStrictEqual([headset, builtIn]);
  });

  it("does not collapse an alias against an output or an unlabelled input", () => {
    const input = { ...builtIn, deviceId: "default" };
    expect(audioInputsFor([
      { kind: "audioinput", ...input },
      { kind: "audiooutput", ...builtIn },
      { kind: "audioinput", ...builtIn, label: "" },
    ])).toStrictEqual([input]);
  });
});

describe("shouldShowPicker", () => {
  it.each([
    { inputs: [], expected: false },
    { inputs: [builtIn], expected: false },
    { inputs: [builtIn, headset], expected: true },
  ])("shows a picker for $inputs.length inputs: $expected", ({ inputs, expected }) => {
    expect(shouldShowPicker(inputs)).toBe(expected);
  });
});

describe("resolveSelectedDevice", () => {
  it.each([
    ["built-in", "built-in"],
    ["unplugged", null],
    [null, null],
  ])("resolves %s to %s", (savedId, expected) => {
    expect(resolveSelectedDevice(savedId, [builtIn, headset])).toBe(expected);
  });
});

describe("audioConstraintsFor", () => {
  it("requests the default microphone without a saved selection", () => {
    expect(audioConstraintsFor(null)).toStrictEqual({ audio: true });
  });

  it("requests the exact selected microphone", () => {
    expect(audioConstraintsFor("headset")).toStrictEqual({
      audio: { deviceId: { exact: "headset" } },
    });
  });
});

describe("describeActiveInput", () => {
  it("prefers the live track label", () => {
    expect(describeActiveInput({ label: "Live input", deviceId: "headset" }, [headset]))
      .toBe("Live input");
  });

  it("uses the matching device label when the track has no label", () => {
    expect(describeActiveInput({ label: "", deviceId: "headset" }, [builtIn, headset]))
      .toBe("Headset microphone");
  });

  it("uses a plain fallback when there is no matching device", () => {
    expect(describeActiveInput({ label: "", deviceId: "missing" }, [builtIn]))
      .toBe("your microphone");
    expect(describeActiveInput({ label: "" }, [])).toBe("your microphone");
  });
});
