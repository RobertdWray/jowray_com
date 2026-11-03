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

/** Hide the picker unless the contributor has a real choice of inputs. */
export function shouldShowPicker(inputs: ReadonlyArray<AudioInputInfo>): boolean {
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

/** Name the live input first so the label reflects what is actually recording. */
export function describeActiveInput(
  track: { label: string; deviceId?: string },
  inputs: ReadonlyArray<AudioInputInfo>,
): string {
  return track.label || inputs.find((input) => input.deviceId === track.deviceId)?.label || "your microphone";
}
