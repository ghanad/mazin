export interface Entry {
  key: string;
  name: string;
  type: "file" | "folder";
  size: number | null;
  lastModified: string | null;
  etag?: string;
  /** Direct, stable download URL (files only). */
  url?: string;
}

export interface SearchHit extends Entry {
  /** Parent folder path without trailing slash ("" = bucket root). */
  folder: string;
}

export interface SearchResponse {
  query: string;
  prefix: string;
  hits: SearchHit[];
  truncated: boolean;
}

export interface ListResponse {
  prefix: string;
  entries: Entry[];
}

export type SortField = "name" | "size" | "modified";
export type SortDirection = "asc" | "desc";
