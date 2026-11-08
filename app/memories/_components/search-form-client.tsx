"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { SEARCH_DEBOUNCE_MS, syncedQuery } from "@/lib/memories/client-logic";
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSearch = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Clean up both when a navigation supplies new filters and when this form unmounts.
  useEffect(() => cancelPendingSearch, [filters, cancelPendingSearch]);

  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input) {
      input.value = syncedQuery(false, input.value, filters.q);
    }
  }, [filters.q]);

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
          cancelPendingSearch();
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            router.replace(searchHref(filters, value), { scroll: false });
          }, SEARCH_DEBOUNCE_MS);
        }}
      />
      {(["place", "decade", "tag", "kind"] as const).map((name) => (
        filters[name] !== undefined && <input key={name} type="hidden" name={name} value={filters[name]} />
      ))}
      <button type="submit" className="sr-only">Search</button>
    </Form>
  );
}
