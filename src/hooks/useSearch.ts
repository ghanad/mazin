"use client";

import { useEffect, useRef, useState } from "react";
import { searchFiles } from "@/lib/api-client";
import type { SearchHit } from "@/types";

export interface GlobalSearch {
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  /** Query the current results belong to ("" when idle). */
  activeQuery: string;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

/**
 * Debounced, race-safe bucket-wide search. Returns nothing until the query
 * has at least two characters; stale responses are dropped by generation.
 */
export function useSearch(prefix: string, rawQuery: string): GlobalSearch {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [activeQuery, setActiveQuery] = useState("");
  const generation = useRef(0);

  const query = rawQuery.trim();

  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) {
      generation.current += 1;
      setLoading(false);
      setError(null);
      setHits([]);
      setTruncated(false);
      setActiveQuery("");
      return;
    }

    const gen = ++generation.current;
    setLoading(true);

    const timer = setTimeout(() => {
      searchFiles(query, prefix)
        .then((res) => {
          if (gen !== generation.current) return;
          setHits(res.hits);
          setTruncated(res.truncated);
          setActiveQuery(query);
          setError(null);
        })
        .catch((err: Error) => {
          if (gen !== generation.current) return;
          setError(err.message || "Search failed");
          setHits([]);
          setTruncated(false);
          setActiveQuery(query);
        })
        .finally(() => {
          if (gen !== generation.current) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [prefix, query]);

  return { hits, loading, error, truncated, activeQuery };
}
