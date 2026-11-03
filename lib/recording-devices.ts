import type { Platform } from "@/lib/recorder-help";

export interface AudioInputInfo {
  deviceId: string;
  label: string;
  groupId: string;
}

/** Offer labelled microphones in browser order, omitting duplicate system aliases. */
export function audioInputsFor(
  devices: ReadonlyArray<{ kind: string; deviceId: string; label: string; groupId: string }>,
): AudioInputInfo[] {
  const inputs = devices.filter((device) => device.kind === "audioinput" && device.label !== "");
  return inputs.filter((input, index) => {
    const alias = input.deviceId === "default" || input.deviceId === "communications";
    return !alias || !inputs.some((other, otherIndex) =>
      otherIndex !== index && other.groupId === input.groupId,
    );
  }).map(({ deviceId, label, groupId }) => ({ deviceId, label, groupId }));
}

/**
 * Offer the picker only where it helps: a desktop with a real choice of
 * inputs. Phones and iPads expose a single microphone (iOS lists exactly one)
 * and the OS, not the page, decides between it and a headset.
 */
export function shouldShowPicker(inputs: ReadonlyArray<AudioInputInfo>, platform: Platform): boolean {
  if (platform === "ios" || platform === "android") {
    return false;
  }
  return inputs.length >= 2;
}

/** Fall back to the system input when a previously selected device disappears. */
export function resolveSelectedDevice(
  savedId: string | null,
  inputs: ReadonlyArray<AudioInputInfo>,
): string | null {
  return savedId !== null && inputs.some((input) => input.deviceId === savedId) ? savedId : null;
}

/** Request the chosen microphone exactly, or let the browser choose its default. */
export function audioConstraintsFor(deviceId: string | null): MediaStreamConstraints {
  return deviceId === null ? { audio: true } : { audio: { deviceId: { exact: deviceId } } };
}

/**
 * Browser device labels carry operating-system noise — Chrome's
 * "Default - " / "Communications - " prefixes and a USB vendor:product pair
 * such as "(0d8c:0005)". A contributor only needs the human part.
 */
export function friendlyInputLabel(label: string): string {
  return label
    .replace(/^(default|communications)\s*-\s*/i, "")
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name the live input first so the label reflects what is actually recording. */
export function describeActiveInput(
  track: { label: string; deviceId?: string },
  inputs: ReadonlyArray<AudioInputInfo>,
): string {
  const raw = track.label || inputs.find((input) => input.deviceId === track.deviceId)?.label || "";
  return friendlyInputLabel(raw) || "your microphone";
}
