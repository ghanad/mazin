"use client";

import { useRef, useState, type RefObject } from "react";
import type { SortDirection, SortField } from "@/types";
import { ArrowUpDownIcon, FolderPlusIcon, RefreshIcon, SearchIcon, SpinnerIcon, UploadIcon } from "./icons";
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
}: ToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

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
          searchFocused ? "sm:w-72" : ""
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
            }
          }}
          placeholder="Filter current folder"
          aria-label="Filter files in this folder"
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
