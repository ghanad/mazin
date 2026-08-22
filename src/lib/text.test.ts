import { describe, expect, it } from "vitest";
import { decodeUtf8, encodeText, isTextFile, MAX_TEXT_FILE_BYTES } from "@/lib/text";

describe("text file policy", () => {
  it("recognizes text MIME types and common extensions", () => {
    expect(isTextFile("README", "text/plain; charset=utf-8")).toBe(true);
    expect(isTextFile("config.yaml")).toBe(true);
    expect(isTextFile("script.BASH")).toBe(true);
    expect(isTextFile("extensionless", "application/json; charset=utf-8")).toBe(true);
    expect(isTextFile("extensionless", "application/javascript")).toBe(true);
    expect(isTextFile("extensionless", "application/octet-stream")).toBe(false);
    expect(isTextFile("archive.bin", "application/octet-stream")).toBe(false);
  });

  it("requires valid UTF-8 and enforces the byte limit", () => {
    expect(decodeUtf8(new TextEncoder().encode("سلام\n"))).toContain("سلام");
    expect(() => decodeUtf8(new Uint8Array([0xc3, 0x28]))).toThrow("UTF-8");
    expect(() => decodeUtf8(new Uint8Array([0x61, 0x00, 0x62]))).toThrow("binary");
    expect(() => encodeText("x".repeat(MAX_TEXT_FILE_BYTES + 1))).toThrow("1048576");
  });
});
