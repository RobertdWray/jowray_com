import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { isShareDraftEmpty, readShareDraft, serializeShareDraft, SHARE_DRAFT_KEY, type ShareDraft } from "@/lib/share-draft";
import { reportClientError } from "@/lib/sentry/report";

const SAVE_DELAY_MS = 500;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch (error) {
    // Private windows and blocked site data throw on access.
    reportClientError(error, { surface: "share-draft", step: "storage" });
    return null;
  }
}

// Read once per page: a stable snapshot keeps useSyncExternalStore quiet, and
// the live form state is the source of truth after the restore.
let snapshot: ShareDraft | null | undefined;
function readDraftOnce(): ShareDraft | null {
  if (snapshot === undefined) {
    const store = storage();
    snapshot = store ? readShareDraft(store, Date.now()) : null;
    if (snapshot && isShareDraftEmpty(snapshot)) {
      snapshot = null;
    }
  }
  return snapshot;
}
function subscribeNever(): () => void {
  return () => {};
}

/**
 * Keeps the typed words on this device (C58): restored once from storage (null
 * on the server and during hydration, C9), saved debounced as the person types,
 * saved at once when the page is hidden (the camera app, a switched tab: the
 * last reliably observable moment on a phone, C45) and on unmount, and cleared
 * on a successful send.
 */
export function useShareDraft(getCurrent: () => ShareDraft): {
  /** The draft found in storage, applied once by the cards reducer and the contributor fields. */
  draft: ShareDraft | null;
  /** Save soon (debounced); for every input. */
  save: () => void;
  /** Save now; before the camera opens or the page is hidden. */
  saveNow: () => void;
  clear: () => void;
} {
  const draft = useSyncExternalStore(subscribeNever, readDraftOnce, () => null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getCurrentRef = useRef(getCurrent);
  useEffect(() => {
    getCurrentRef.current = getCurrent;
  }, [getCurrent]);

  const saveNow = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const store = storage();
    if (!store) {
      return;
    }
    const current = getCurrentRef.current();
    try {
      if (isShareDraftEmpty(current)) {
        store.removeItem(SHARE_DRAFT_KEY);
      } else {
        store.setItem(SHARE_DRAFT_KEY, serializeShareDraft(current, Date.now()));
      }
    } catch (error) {
      // Quota or blocked storage: the form still works without a draft.
      reportClientError(error, { surface: "share-draft", step: "save" });
    }
  }, []);

  const save = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(saveNow, SAVE_DELAY_MS);
  }, [saveNow]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && timerRef.current !== null) {
        saveNow();
      }
    };
    const onPageHide = () => {
      if (timerRef.current !== null) {
        saveNow();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      if (timerRef.current !== null) {
        saveNow();
      }
    };
  }, [saveNow]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    snapshot = null;
    try {
      storage()?.removeItem(SHARE_DRAFT_KEY);
    } catch (error) {
      // Nothing to clear.
      reportClientError(error, { surface: "share-draft", step: "clear" });
    }
  }, []);

  return { draft, save, saveNow, clear };
}
