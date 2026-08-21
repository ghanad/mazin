/**
 * Minimal extension -> MIME mapping. Used as a fallback when an object has
 * no stored Content-Type. Anything unknown becomes application/octet-stream.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  iso: "application/octet-stream",
  img: "application/octet-stream",
  bin: "application/octet-stream",
  dmg: "application/x-apple-diskimage",
  qcow2: "application/x-qemu-disk",
  vmdk: "application/x-vmdk-disk",
  raw: "application/octet-stream",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  tar: "application/x-tar",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  ini: "text/plain",
  conf: "text/plain",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/plain",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  deb: "application/vnd.debian.binary-package",
  rpm: "application/x-rpm",
  exe: "application/x-msdownload",
  msi: "application/x-msi",
  apk: "application/vnd.android.package-archive",
  sig: "application/pgp-signature",
  asc: "text/plain",
  sha256: "text/plain",
};

export const DEFAULT_MIME = "application/octet-stream";

export function getMimeType(filenameOrKey: string): string {
  const base = filenameOrKey.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return DEFAULT_MIME;
  const ext = base.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? DEFAULT_MIME;
}

/**
 * Content-Type values that browsers may try to render inline. The download
 * endpoint forces `attachment` disposition for everything, but we keep this
 * helper for potential future use and tests.
 */
export function isPreviewable(mime: string): boolean {
  return /^(image|video|audio)\//.test(mime) || mime === "application/pdf";
}
