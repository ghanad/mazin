import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";

describe("formatBytes", () => {
  it("formats the documented examples", () => {
    expect(formatBytes(950)).toBe("950 B");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(74 * 1024 * 1024)).toBe("74 MB");
    expect(formatBytes(Math.round(1.6 * 1024 ** 3))).toBe("1.6 GB");
    expect(formatBytes(Math.round(9.8 * 1024 ** 3))).toBe("9.8 GB");
  });

  it("handles boundaries and invalid input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 ** 4)).toBe("1 TB");
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-5)).toBe("—");
  });
});

describe("formatDate", () => {
  it("renders human dates", () => {
    const date = new Date(2026, 7, 21); // Aug 21 2026, local time
    expect(formatDate(date.toISOString())).toBe("Aug 21, 2026");
  });

  it("falls back for missing/invalid values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("includes a time portion", () => {
    const date = new Date(2026, 7, 21, 14, 30);
    expect(formatDateTime(date)).toMatch(/^Aug 21, 2026 14:30$/);
  });
});
