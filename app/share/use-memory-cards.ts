import { useReducer, useState } from "react";

import { cardsReducer, initialCardsState, type CardsAction, type CardsState } from "@/lib/memory-cards";
import type { ShareDraft } from "@/lib/share-draft";

/**
 * The cards' state: one pure reducer (C11), deterministic initial ids so the
 * server and client render the same markup (C5), and a saved draft applied
 * once, during render, as React prefers over an Effect (C10).
 */
export function useMemoryCards(draft: ShareDraft | null): { state: CardsState; dispatch: React.Dispatch<CardsAction>; restored: boolean } {
  const [state, dispatch] = useReducer(cardsReducer, undefined, initialCardsState);
  const [restored, setRestored] = useState(false);
  if (draft !== null && !restored) {
    setRestored(true);
    if (draft.cards.length > 0) {
      dispatch({ type: "restore", cards: draft.cards });
    }
  }
  return { state, dispatch, restored: restored && draft !== null && draft.cards.length > 0 };
}
