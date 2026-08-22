import type { ListResponse, SearchResponse } from "@/types";

export interface TextFileResponse {
  key: string;
  content: string;
  contentType?: string;
  size: number;
  etag?: string;
  lastModified?: string;
}

/** Error thrown by API calls; carries HTTP status and conflict flags. */
export class ApiError extends Error {
  status: number;
  exists: boolean;
  constructor(message: string, status: number, exists = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.exists = exists;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("Network error — is the server reachable?", 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let exists = false;
    try {
      const body = (await res.json()) as { error?: string; exists?: boolean };
      if (body.error) message = body.error;
      exists = Boolean(body.exists);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, exists);
  }
  return (await res.json()) as T;
}

export function listFiles(prefix: string): Promise<ListResponse> {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  const qs = params.toString();
  return request<ListResponse>(`/api/files${qs ? `?${qs}` : ""}`);
}

export function searchFiles(query: string, prefix = ""): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (prefix) params.set("prefix", prefix);
  return request<SearchResponse>(`/api/search?${params.toString()}`);
}

export function createFolder(prefix: string, name: string): Promise<{ ok: boolean }> {
  return request("/api/folders", {
    method: "POST",
    body: JSON.stringify({ prefix, name }),
  });
}

export function deleteEntry(key: string, type: "file" | "folder"): Promise<{ ok: boolean }> {
  return request("/api/files", {
    method: "DELETE",
    body: JSON.stringify({ key, type }),
  });
}

export function renameEntry(
  from: string,
  to: string,
  isFolder: boolean,
  overwrite: boolean,
): Promise<{ ok: boolean }> {
  return request("/api/files/rename", {
    method: "POST",
    body: JSON.stringify({ from, to, isFolder, overwrite }),
  });
}

export function getTextFile(key: string): Promise<TextFileResponse> {
  return request<TextFileResponse>(`/api/files/text?key=${encodeURIComponent(key)}`);
}

export function saveTextFile(key: string, content: string, expectedEtag: string): Promise<TextFileResponse> {
  return request<TextFileResponse>("/api/files/text", {
    method: "PUT",
    body: JSON.stringify({ key, content, expectedEtag }),
  });
}

/* ---------- upload orchestration API ---------- */

export interface PresignedPartDto {
  partNumber: number;
  url: string;
}

export type CreateUploadResponse =
  | { mode: "single"; key: string; url: string; expiresInSeconds: number }
  | {
      mode: "multipart";
      key: string;
      uploadId: string;
      partSize: number;
      parts: PresignedPartDto[];
      expiresInSeconds: number;
    };

export function createUpload(opts: {
  prefix: string;
  name: string;
  size: number;
  contentType: string;
  overwrite?: boolean;
}): Promise<CreateUploadResponse> {
  return request<CreateUploadResponse>("/api/uploads/create", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function presignParts(
  key: string,
  uploadId: string,
  partNumbers: number[],
): Promise<{ parts: PresignedPartDto[]; expiresInSeconds: number }> {
  return request("/api/uploads/presign-part", {
    method: "POST",
    body: JSON.stringify({ key, uploadId, partNumbers }),
  });
}

export function completeUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<{ ok: boolean; etag?: string }> {
  return request("/api/uploads/complete", {
    method: "POST",
    body: JSON.stringify({ key, uploadId, parts }),
  });
}

export function abortUpload(key: string, uploadId: string): Promise<{ ok: boolean }> {
  return request("/api/uploads/abort", {
    method: "POST",
    body: JSON.stringify({ key, uploadId }),
  });
}
