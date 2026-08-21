import { describe, expect, it } from "vitest";
import {
  folderMarkerKey,
  folderNameFromKey,
  joinKey,
  normalizePrefix,
  parentPathOf,
  validateKey,
  validateName,
} from "@/lib/validation/keys";
import { ValidationError } from "@/lib/errors";

describe("normalizePrefix", () => {
  it("treats empty and root as bucket root", () => {
    expect(normalizePrefix(null)).toBe("");
    expect(normalizePrefix(undefined)).toBe("");
    expect(normalizePrefix("")).toBe("");
    expect(normalizePrefix("/")).toBe("");
  });

  it("canonicalizes to a trailing slash", () => {
    expect(normalizePrefix("ISO")).toBe("ISO/");
    expect(normalizePrefix("ISO/Linux")).toBe("ISO/Linux/");
    expect(normalizePrefix("/ISO/Linux/")).toBe("ISO/Linux/");
    expect(normalizePrefix("ISO//Linux//")).toBe("ISO/Linux/");
  });

  it("rejects traversal segments", () => {
    expect(() => normalizePrefix("..")).toThrow(ValidationError);
    expect(() => normalizePrefix("../..")).toThrow(ValidationError);
    expect(() => normalizePrefix("ISO/../../etc")).toThrow(ValidationError);
    expect(() => normalizePrefix(".")).toThrow(ValidationError);
  });

  it("does not double-decode (framework already decoded once)", () => {
    // A literal "%" in a folder name must survive untouched.
    expect(normalizePrefix("100% done")).toBe("100% done/");
    expect(normalizePrefix("a%2Fb")).toBe("a%2Fb/");
  });

  it("preserves unicode and spaces", () => {
    expect(normalizePrefix("نسخه نهایی")).toBe("نسخه نهایی/");
    expect(normalizePrefix("Ubuntu Server (Final) #2")).toBe(
      "Ubuntu Server (Final) #2/",
    );
  });
});

describe("validateName", () => {
  it("accepts ordinary, unicode and special-character names", () => {
    expect(validateName("ubuntu-24.04.3.iso")).toBe("ubuntu-24.04.3.iso");
    expect(validateName("نسخه-نهایی.iso")).toBe("نسخه-نهایی.iso");
    expect(validateName("Ubuntu Server (Final) #2.iso")).toBe(
      "Ubuntu Server (Final) #2.iso",
    );
    expect(validateName("50%+1 (report).txt")).toBe("50%+1 (report).txt");
  });

  it("rejects empty, slashes, traversal and control characters", () => {
    expect(() => validateName("")).toThrow(ValidationError);
    expect(() => validateName("   ")).toThrow(ValidationError);
    expect(() => validateName("a/b")).toThrow(ValidationError);
    expect(() => validateName(".")).toThrow(ValidationError);
    expect(() => validateName("..")).toThrow(ValidationError);
    expect(() => validateName("bad\u0000name")).toThrow(ValidationError);
    expect(() => validateName("x".repeat(256))).toThrow(ValidationError);
  });
});

describe("validateKey", () => {
  it("keeps folder keys with a trailing slash", () => {
    expect(validateKey("ISO/Linux/")).toBe("ISO/Linux/");
  });

  it("normalizes file keys", () => {
    expect(validateKey("ISO/ubuntu 24.04.iso")).toBe("ISO/ubuntu 24.04.iso");
  });

  it("rejects absolute keys, traversal and empties", () => {
    expect(() => validateKey("/etc/passwd")).toThrow(ValidationError);
    expect(() => validateKey("a/../b")).toThrow(ValidationError);
    expect(() => validateKey("")).toThrow(ValidationError);
    expect(() => validateKey("//")).toThrow(ValidationError);
    expect(() => validateKey("\u0007")).toThrow(ValidationError);
  });

  it("enforces the S3 key byte limit", () => {
    const long = "ä".repeat(600); // 1200 bytes in UTF-8
    expect(() => validateKey(long)).toThrow(ValidationError);
  });
});

describe("joinKey / parentPathOf / helpers", () => {
  it("joins prefix and name", () => {
    expect(joinKey("ISO/", "ubuntu.iso")).toBe("ISO/ubuntu.iso");
    expect(joinKey("", "file.bin")).toBe("file.bin");
    expect(joinKey("ISO", "Linux")).toBe("ISO/Linux");
  });

  it("computes parent paths", () => {
    expect(parentPathOf("ISO/a.txt")).toBe("ISO");
    expect(parentPathOf("a.txt")).toBe("");
    expect(parentPathOf("ISO/Linux/")).toBe("ISO");
  });

  it("marker key equals normalized prefix", () => {
    expect(folderMarkerKey("ISO/Linux")).toBe("ISO/Linux/");
  });

  it("derives folder display names", () => {
    expect(folderNameFromKey("ISO/Linux/", "ISO/")).toBe("Linux");
    expect(folderNameFromKey("VMware", "")).toBe("VMware");
  });
});
