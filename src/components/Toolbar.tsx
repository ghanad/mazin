"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SearchHit, SortDirection, SortField } from "@/types";
import { ArrowUpDownIcon, FileIcon, FolderIcon, FolderPlusIcon, RefreshIcon, SearchIcon, SpinnerIcon, UploadIcon } from "./icons";
import { Button } from "./ui";

export interface ToolbarProps {
  onUploadClick: () => void;
  onFilesSelected: (files: FileList) => void;
  onNewFolder: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField, direction: SortDirection) => void;
  onRefresh: () => void;
  refreshing: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Bucket-wide search results for `query` (see useSearch). */
  search: {
    hits: SearchHit[];
    loading: boolean;
    error: string | null;
    truncated: boolean;
    activeQuery: string;
  };
  onOpenHit: (hit: SearchHit) => void;
}

const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  size: "Size",
  modified: "Modified",
};

export function Toolbar({
  onUploadClick,
  onFilesSelected,
  onNewFolder,
  query,
  onQueryChange,
  sortField,
  sortDirection,
  onSortChange,
  onRefresh,
  refreshing,
  fileInputRef,
  search,
  onOpenHit,
}: ToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [selected, setSelected] = useState(0);

  const trimmed = query.trim();
  const showResults = searchFocused && trimmed.length >= 2;

  useEffect(() => {
    setSelected(0);
  }, [search.activeQuery, search.hits.length]);

  const openHit = (hit: SearchHit) => {
    onOpenHit(hit);
    setSearchFocused(false);
    searchRef.current?.blur();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) onFilesSelected(e.target.files);
          e.target.value = "";
        }}
        data-upload-input
      />

      <Button variant="primary" onClick={onUploadClick}>
        <UploadIcon />
        Upload
      </Button>
      <Button onClick={onNewFolder}>
        <FolderPlusIcon />
        New folder
      </Button>

      <div className="flex-1" />

      {/* Search / filter */}
      <div
        className={`relative h-9 w-full transition-colors sm:w-56 ${
          searchFocused ? "sm:w-80" : ""
        }`}
      >
        <SearchIcon
          width={15}
          height={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
        />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onQueryChange("");
              searchRef.current?.blur();
              return;
            }
            if (!showResults || search.hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, search.hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              openHit(search.hits[selected]);
            }
          }}
          placeholder="Search all files…"
          aria-label="Search files in every folder"
          aria-expanded={showResults}
          aria-controls="global-search-results"
          role="combobox"
          className="h-9 w-full rounded-md border border-zinc-300 bg-white pl-8 pr-8 text-sm text-zinc-900 placeholder:text-zinc-400 transition-[width] duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {query && (
          <button
            onClick={() => {
              onQueryChange("");
              searchRef.current?.focus();
            }}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}

        {/* Bucket-wide results */}
        {showResults && (
          <div
            id="global-search-results"
            className="animate-rise-in absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-96 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-950/10"
          >
            {search.loading && search.hits.length === 0 ? (
              <p className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-500">
                <SpinnerIcon width={14} height={14} /> Searching…
              </p>
            ) : search.error ? (
              <p role="alert" className="px-3 py-2 text-sm text-red-600">{search.error}</p>
            ) : search.hits.length === 0 ? (
              <p className="px-3 py-2 text-sm text-zinc-500">
                No matches in any folder for “{trimmed}”
              </p>
            ) : (
              <>
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  All folders
                </p>
                <ul role="listbox" aria-label="Search results across all folders">
                  {search.hits.map((hit, i) => (
                    <li key={`${hit.type}:${hit.key}`} role="presentation">
                      <button
                        role="option"
                        aria-selected={i === selected}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => openHit(hit)}
                        onMouseEnter={() => setSelected(i)}
                        title={hit.folder ? `${hit.folder}/${hit.name}` : hit.name}
                        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                          i === selected ? "bg-blue-50" : ""
                        }`}
                      >
                        {hit.type === "folder" ? (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-50">
                            <FolderIcon width={14} height={14} className="text-blue-500" />
                          </span>
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-100">
                            <FileIcon width={13} height={13} className="text-zinc-400" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{hit.name}</span>
                        <span className="hidden min-w-0 max-w-[45%] truncate text-xs text-zinc-400 sm:block">
                          {hit.folder || "/"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {(search.truncated || search.hits.length >= 200) && (
                  <p className="border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-400">
                    Showing the first 200 matches — refine your search.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center">
        <label htmlFor="sort-field" className="sr-only">
          Sort by
        </label>
        <select
          id="sort-field"
          value={sortField}
          onChange={(e) => onSortChange(e.target.value as SortField, sortDirection)}
          className="h-9 rounded-l-md border border-r-0 border-zinc-300 bg-white pl-2.5 pr-6 text-sm text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        >
          {(Object.keys(SORT_LABELS) as SortField[]).map((field) => (
            <option key={field} value={field}>
              {SORT_LABELS[field]}
            </option>
          ))}
        </select>
        <button
          onClick={() => onSortChange(sortField, sortDirection === "asc" ? "desc" : "asc")}
          aria-label={sortDirection === "asc" ? "Sort descending" : "Sort ascending"}
          title={sortDirection === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
          className="flex h-9 items-center gap-1 rounded-r-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
        >
          <ArrowUpDownIcon width={14} height={14} />
          <span className="text-xs font-medium">{sortDirection === "asc" ? "A→Z" : "Z→A"}</span>
        </button>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        aria-label="Refresh listing"
        title="Refresh"
      >
        {refreshing ? <SpinnerIcon /> : <RefreshIcon />}
      </Button>
    </div>
  );
}
