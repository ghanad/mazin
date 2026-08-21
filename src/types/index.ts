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

export interface ListResponse {
  prefix: string;
  entries: Entry[];
}

export type SortField = "name" | "size" | "modified";
export type SortDirection = "asc" | "desc";
