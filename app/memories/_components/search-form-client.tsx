"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { createDebounce, type Debounce, SEARCH_DEBOUNCE_MS, syncedQuery } from "@/lib/memories/client-logic";
import type { ExploreFilters } from "@/lib/memories/types";

import { inputClass } from "../../_components/field-classes";
import { searchHref } from "./hrefs";

/** Enhance a GET search form with debounced navigation without replacing the visitor's active edit. */
export function SearchForm({
  filters,
  inputId = "q",
  compact = false,
}: {
  filters: ExploreFilters;
  inputId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<Debounce | null>(null);
  const pendingSearch = () => (pendingRef.current ??= createDebounce(SEARCH_DEBOUNCE_MS));
  const cancelPendingSearch = useCallback(() => pendingRef.current?.cancel(), []);

  // Clean up both when a navigation supplies new filters and when this form unmounts.
  useEffect(() => cancelPendingSearch, [filters, cancelPendingSearch]);

  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input) {
      input.value = syncedQuery(false, input.value, filters.q);
    }
    // Every navigation brings a new `filters` (even when `q` is unchanged, e.g. Back after a chip pressed mid-typing),
    // so the unfocused field always shows the search the page is actually showing.
  }, [filters]);

  return (
    <Form action="/memories" scroll={false} onSubmit={cancelPendingSearch} className="flex flex-col gap-2">
      <label htmlFor={inputId} className={`${compact ? "text-small" : "text-label"} font-bold`}>
        Look for a word, a name or a place
      </label>
      <input
        ref={inputRef}
        id={inputId}
        name="q"
        type="search"
        placeholder="quilt"
        defaultValue={filters.q ?? ""}
        autoComplete="off"
        enterKeyHint="search"
        className={inputClass}
        onInput={(event) => {
          const value = event.currentTarget.value;
          pendingSearch().schedule(() => router.replace(searchHref(filters, value), { scroll: false }));
        }}
        // A press elsewhere (a filter chip, any link on the page) takes focus first: unsent typing is abandoned there, so
        // a late timer can never replace that navigation with the old filters (TCR round 1, B2-3).
        onBlur={cancelPendingSearch}
      />
      {(["place", "decade", "tag", "kind"] as const).map((name) => (
        filters[name] !== undefined && <input key={name} type="hidden" name={name} value={filters[name]} />
      ))}
      <button type="submit" className="sr-only">Search</button>
    </Form>
  );
}
