/**
 * What the claim page says when a save sent an APPROVED memory back for review (plan 2026-11-08 D17): the change is
 * kept, and the memory leaves See memories until the family has read it again.
 */
export const REVIEW_AGAIN_AFTER = "The family will take another look before it is back on See memories.";

/** The full message after a save of words or a file's caption. */
export const REVIEW_AGAIN = `Saved. ${REVIEW_AGAIN_AFTER}`;

/**
 * What the claim page says after a save of the memory's words and details. `reopenedOthers` counts the contributor's
 * other APPROVED memories that went back for review because they show the same name and relationship (TCR round 1,
 * B1-2), so the contributor is not surprised when those leave See memories too.
 */
export function claimSaveMessage({ reopened, reopenedOthers }: { reopened: boolean; reopenedOthers: number }): string {
  if (reopenedOthers === 0) {
    return reopened ? REVIEW_AGAIN : "Saved.";
  }
  if (reopened) {
    const others = reopenedOthers === 1 ? "the other one" : `the ${reopenedOthers} others`;
    return `Saved. The family will take another look at this memory and ${others} with your name before they are back on See memories.`;
  }
  return reopenedOthers === 1
    ? "Saved. Your name and relationship also show on one other memory; the family will take another look at it before it is back on See memories."
    : `Saved. Your name and relationship also show on ${reopenedOthers} other memories; the family will take another look at them before they are back on See memories.`;
}
