import { describe, expect, it } from "vitest";
import {
  contentDispositionFor,
  encodeKeyToPath,
  encodeKeyToUrlPath,
  isForwardableRange,
  parseRangeHeader,
} from "@/lib/http/path";
import { RangeNotSatisfiableError } from "@/lib/errors";

describe("encodeKeyToPath", () => {
  it("keeps / as separator and encodes spaces", () => {
    expect(encodeKeyToPath("ISO/ubuntu 24.04.iso")).toBe(
      "ISO/ubuntu%2024.04.iso",
    );
  });

  it("encodes #, ?, %, + but keeps parentheses", () => {
    expect(encodeKeyToPath("Ubuntu Server (Final) #2.iso")).toBe(
      "Ubuntu%20Server%20(Final)%20%232.iso",
    );
    expect(encodeKeyToPath("q&a.txt")).toBe("q%26a.txt");
    expect(encodeKeyToPath("what?.txt")).toBe("what%3F.txt");
    expect(encodeKeyToPath("50%+1.iso")).toBe("50%25%2B1.iso");
  });

  it("percent-encodes unicode (Persian) as UTF-8", () => {
    const encoded = encodeKeyToPath("iso/نسخه-نهایی.iso");
    expect(encoded).not.toContain("ن");
    // Round trip must restore the original key exactly.
    const decoded = encoded
      .split("/")
      .map((s) => decodeURIComponent(s))
      .join("/");
    expect(decoded).toBe("iso/نسخه-نهایی.iso");
  });

  it("round-trips every tricky character through decodeURIComponent", () => {
    const keys = [
      "a b/c d.txt",
      "hash#tag.txt",
      "question?mark.txt",
      "percent%50.txt",
      "plus+plus.bin",
      "paren(theses).txt",
      "emoji🙂.png",
      "quote'single.txt",
    ];
    for (const key of keys) {
      const decoded = encodeKeyToPath(key)
        .split("/")
        .map((s) => decodeURIComponent(s))
        .join("/");
      expect(decoded).toBe(key);
    }
  });

  it("builds absolute URL paths", () => {
    expect(encodeKeyToUrlPath("ISO/a.iso")).toBe("/ISO/a.iso");
    expect(encodeKeyToUrlPath("")).toBe("/");
  });
});

describe("contentDispositionFor", () => {
  it("provides ASCII fallback and RFC 5987 UTF-8 name", () => {
    const header = contentDispositionFor("ISO/نسخه-نهایی.iso");
    // Non-ASCII characters become underscores in the ASCII fallback;
    // the full UTF-8 name travels in the filename* parameter.
    expect(header).toMatch(/^attachment; filename="____-_____\.iso"; filename\*=UTF-8''/);
    expect(header).toContain(encodeURIComponent("نسخه-نهایی.iso"));
  });

  it("handles plain ascii names with quotes safely", () => {
    const header = contentDispositionFor('weird"name.iso');
    expect(header).toContain('filename="weird_name.iso"');
  });

  it("supports inline disposition for previews", () => {
    const header = contentDispositionFor("docs/manual.pdf", "inline");
    expect(header).toMatch(/^inline; filename="manual\.pdf"/);
  });
});

describe("parseRangeHeader", () => {
  it("parses a normal range", () => {
    expect(parseRangeHeader("bytes=0-1023", 6500000000)).toEqual({
      start: 0,
      end: 1023,
    });
  });

  it("parses open-ended ranges", () => {
    expect(parseRangeHeader("bytes=100-", undefined)).toEqual({ start: 100 });
  });

  it("parses suffix ranges against a known size", () => {
    expect(parseRangeHeader("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("clamps suffix ranges larger than the object", () => {
    expect(parseRangeHeader("bytes=-9999", 100)).toEqual({ start: 0, end: 99 });
  });

  it("returns null for multi-range and malformed headers", () => {
    expect(parseRangeHeader(null)).toBeNull();
    expect(parseRangeHeader(undefined)).toBeNull();
    expect(parseRangeHeader("bytes=0-1,5-6")).toBeNull();
    expect(parseRangeHeader("items=0-1")).toBeNull();
    expect(parseRangeHeader("bytes=a-b")).toBeNull();
    expect(parseRangeHeader("bytes=-")).toBeNull();
    expect(parseRangeHeader("bytes=10-5")).toBeNull();
  });

  it("throws 416 when start is beyond the object size", () => {
    expect(() => parseRangeHeader("bytes=100-200", 50)).toThrow(
      RangeNotSatisfiableError,
    );
    expect(() => parseRangeHeader("bytes=-1", 0)).toThrow(RangeNotSatisfiableError);
  });
});

describe("isForwardableRange", () => {
  it("accepts single byte ranges only", () => {
    expect(isForwardableRange("bytes=0-1023")).toBe(true);
    expect(isForwardableRange("bytes=100-")).toBe(true);
    expect(isForwardableRange("bytes=-500")).toBe(true);
    expect(isForwardableRange("bytes=0-1,5-6")).toBe(false);
    expect(isForwardableRange("garbage")).toBe(false);
    expect(isForwardableRange(null)).toBe(false);
  });
});
