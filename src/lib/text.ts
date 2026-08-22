import { MAX_TEXT_FILE_BYTES, isTextFile } from "@/lib/mime";
import { ValidationError } from "@/lib/errors";

export { MAX_TEXT_FILE_BYTES, isTextFile };

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) throw new Error("binary NUL byte");
    return text;
  } catch {
    throw new ValidationError("The file contains binary or invalid UTF-8 data");
  }
}

export function encodeText(content: unknown): Uint8Array {
  if (typeof content !== "string") throw new ValidationError("content must be a string");
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
    throw new ValidationError(`Text files must be ${MAX_TEXT_FILE_BYTES} bytes or smaller`);
  }
  return bytes;
}
