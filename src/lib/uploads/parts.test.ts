import { describe, expect, it } from "vitest";
import {
  MAX_PARTS,
  MIN_PART_SIZE,
  computePartCount,
  computePartSize,
  partNumbersFor,
} from "@/lib/uploads/parts";

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("multipart part math", () => {
  it("uses the configured part size for typical large files", () => {
    expect(computePartSize(10 * GB, 64 * MB)).toBe(64 * MB);
    expect(computePartCount(10 * GB, 64 * MB)).toBe(160);
  });

  it("enforces a sane minimum part size", () => {
    expect(computePartSize(100 * MB, 1 * MB)).toBe(MIN_PART_SIZE);
  });

  it("grows the part size so the 10k part limit is never exceeded", () => {
    const huge = 80_000 * GB; // would need >10k parts at 64 MiB
    const partSize = computePartSize(huge, 64 * MB);
    expect(computePartCount(huge, partSize)).toBeLessThanOrEqual(MAX_PARTS);
  });

  it("treats zero-byte files as a single part", () => {
    expect(computePartCount(0, 64 * MB)).toBe(1);
    expect(partNumbersFor(0, 64 * MB)).toEqual([1]);
  });

  it("generates sequential part numbers", () => {
    expect(partNumbersFor(200 * MB, 64 * MB)).toEqual([1, 2, 3, 4]);
  });
});
