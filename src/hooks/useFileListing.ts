"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listFiles } from "@/lib/api-client";
import type { Entry } from "@/types";

export interface FileListing {
  entries: Entry[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
}

/** Fetches (and refetches) the listing for a prefix. */
export function useFileListing(prefix: string): FileListing {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstLoadForPrefix = useRef(true);
  const generation = useRef(0);

  const load = useCallback(() => {
    const gen = ++generation.current;
    if (firstLoadForPrefix.current) setLoading(true);
    else setRefreshing(true);

    listFiles(prefix)
      .then((res) => {
        if (gen !== generation.current) return;
        setEntries(res.entries);
        setError(null);
      })
      .catch((err: Error) => {
        if (gen !== generation.current) return;
        setError(err.message || "Failed to load files");
      })
      .finally(() => {
        if (gen !== generation.current) return;
        firstLoadForPrefix.current = false;
        setLoading(false);
        setRefreshing(false);
      });
  }, [prefix]);

  useEffect(() => {
    firstLoadForPrefix.current = true;
    setEntries([]);
    load();
  }, [load]);

  return { entries, loading, refreshing, error, reload: load };
}
