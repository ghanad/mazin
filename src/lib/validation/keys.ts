import { ValidationError } from "@/lib/errors";

/**
 * S3 key / prefix handling.
 *
 * S3 keys are arbitrary UTF-8 strings up to 1024 bytes. Folders are
 * emulated with "/"-delimited prefixes plus a zero-byte placeholder object
 * whose key ends with "/" (the same convention used by the AWS console and
 * most S3 tools).
 *
 * All user input that ends up in a key must pass through this module so
 * path traversal and malformed keys are impossible.
 */

export const FOLDER_MARKER_SUFFIX = "/";

/** Maximum object name (single path segment) length in characters. */
export const MAX_NAME_LENGTH = 255;
/** Maximum total key length in bytes (S3 hard limit). */
export const MAX_KEY_BYTES = 1024;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Normalize a prefix into canonical form.
 *
 * IMPORTANT: input is expected to be already URL-decoded exactly once by the
 * framework (URLSearchParams / dynamic route params). This function must NOT
 * decode again, otherwise keys containing literal "%" would be corrupted.
 *
 * - undefined/null/"" -> "" (bucket root)
 * - collapses duplicate slashes, strips leading/trailing slashes
 * - rejects traversal segments ("." / "..")
 * Returns the prefix WITH a trailing slash when non-empty.
 */
export function normalizePrefix(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  if (raw === "" || raw === "/") return "";

  const segments = raw.split("/").filter((s) => s.length > 0);
  for (const segment of segments) {
    validateName(segment, "prefix segment");
  }
  return segments.join("/") + "/";
}

/** Validate a single object/folder NAME (one path segment, no slashes). */
export function validateName(name: string, label = "name"): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError(`${label} must not be empty`);
  }
  if (name.includes("/")) {
    throw new ValidationError(`${label} must not contain "/"`);
  }
  if (name === "." || name === "..") {
    throw new ValidationError(`${label} is not allowed`);
  }
  if (CONTROL_CHARS.test(name)) {
    throw new ValidationError(`${label} contains control characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`${label} exceeds ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

/**
 * Validate a full object key or folder prefix arriving from the client
 * (already split into decoded segments by the caller for [...path] routes).
 * Returns the canonical key. Folder keys keep their trailing slash.
 */
export function validateKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new ValidationError("Key must not be empty");
  }
  if (key.startsWith("/")) {
    throw new ValidationError("Key must be relative to the bucket root");
  }
  if (CONTROL_CHARS.test(key)) {
    throw new ValidationError("Key contains control characters");
  }
  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw new ValidationError(`Key exceeds ${MAX_KEY_BYTES} bytes`);
  }
  const isFolder = key.endsWith("/");
  const segments = key.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new ValidationError("Key must contain at least one segment");
  }
  for (const segment of segments) {
    validateName(segment, "key segment");
  }
  return segments.join("/") + (isFolder ? FOLDER_MARKER_SUFFIX : "");
}

/** Join a normalized prefix (trailing slash) with a validated name. */
export function joinKey(prefix: string, name: string): string {
  const cleanPrefix = normalizePrefix(prefix);
  validateName(name);
  return cleanPrefix + name;
}

/** Key of the zero-byte placeholder object representing `prefix` itself. */
export function folderMarkerKey(prefix: string): string {
  return normalizePrefix(prefix);
}

/** Display name of a folder entry from its common-prefix or marker key. */
export function folderNameFromKey(key: string, parentPrefix: string): string {
  const name = key.slice(parentPrefix.length).replace(/\/+$/, "");
  return name.split("/").pop() ?? name;
}

/** Parent path of a key or prefix, without trailing slash ("a/b/c" -> "a/b"). */
export function parentPathOf(key: string): string {
  const segments = key.split("/").filter((s) => s.length > 0);
  segments.pop();
  return segments.join("/");
}
