import { useCallback, useEffect, useRef, useState } from "react";

import {
  EMPTY_SHARE_DRAFT,
  isShareDraftEmpty,
  parseShareDraft,
  serializeShareDraft,
  SHARE_DRAFT_KEY,
  type ShareDraft,
} from "@/lib/share-draft";

const SAVE_DELAY_MS = 500;
const FIELDS = Object.keys(EMPTY_SHARE_DRAFT) as Array<keyof ShareDraft>;

function readFields(form: HTMLFormElement): ShareDraft {
  const data = new FormData(form);
  const draft = { ...EMPTY_SHARE_DRAFT };
  for (const field of FIELDS) {
    const value = data.get(field);
    draft[field] = typeof value === "string" ? value : "";
  }
  return draft;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Private windows and blocked site data throw on access.
    return null;
  }
}

/**
 * Keeps the typed story on this device while the contributor follows
 * microphone help that may close the tab ("quit and reopen the browser").
 * Restores into the uncontrolled inputs on mount, saves on input (debounced),
 * and is cleared on a successful send.
 */
export function useShareDraft(): {
  /** Pass as the form's `ref`; restores the draft when the form mounts. */
  attachForm: (form: HTMLFormElement | null) => void;
  restored: boolean;
  onInput: () => void;
  clear: () => void;
} {
  const [restored, setRestored] = useState(false);
  const formElement = useRef<HTMLFormElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A ref callback (not an effect): it runs once the inputs exist, fills them
  // in place and may flag the restore without a cascading re-render.
  const attachForm = useCallback((form: HTMLFormElement | null) => {
    formElement.current = form;
    const store = storage();
    if (!form || !store) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = store.getItem(SHARE_DRAFT_KEY);
    } catch {
      return;
    }
    const draft = parseShareDraft(raw, Date.now());
    if (!draft || isShareDraftEmpty(draft)) {
      return;
    }
    let filled = false;
    for (const field of FIELDS) {
      const element = form.elements.namedItem(field);
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.value === "" && draft[field] !== "") {
        element.value = draft[field];
        filled = true;
      }
    }
    if (filled) {
      setRestored(true);
    }
  }, []);

  /** Write the fields now; the debounce only decides when this runs. */
  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const form = formElement.current;
    const store = storage();
    if (!form || !store) {
      return;
    }
    const draft = readFields(form);
    try {
      if (isShareDraftEmpty(draft)) {
        store.removeItem(SHARE_DRAFT_KEY);
      } else {
        store.setItem(SHARE_DRAFT_KEY, serializeShareDraft(draft, Date.now()));
      }
    } catch {
      // Quota or blocked storage: the form still works without a draft.
    }
  }, []);

  // Closing the tab inside the debounce window must not lose the last words:
  // flush on pagehide (the reliable "leaving" signal on phones) and on unmount.
  useEffect(() => {
    const onPageHide = () => {
      if (timerRef.current !== null) {
        flush();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (timerRef.current !== null) {
        flush();
      }
    };
  }, [flush]);

  const onInput = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRestored(false);
    try {
      storage()?.removeItem(SHARE_DRAFT_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);

  return { attachForm, restored, onInput, clear };
}
