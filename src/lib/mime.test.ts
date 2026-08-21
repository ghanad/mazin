import { describe, expect, it } from "vitest";
import { DEFAULT_MIME, getMimeType } from "@/lib/mime";

describe("getMimeType", () => {
  it("maps common extensions", () => {
    expect(getMimeType("ubuntu-24.04.3.iso")).toBe("application/octet-stream");
    expect(getMimeType("backup.zip")).toBe("application/zip");
    expect(getMimeType("manual.pdf")).toBe("application/pdf");
    expect(getMimeType("notes.txt")).toBe("text/plain");
    expect(getMimeType("photo.jpg")).toBe("image/jpeg");
    expect(getMimeType("photo.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream safely", () => {
    expect(getMimeType("archive.zst")).toBe(DEFAULT_MIME);
    expect(getMimeType("noextension")).toBe(DEFAULT_MIME);
    expect(getMimeType(".hidden")).toBe(DEFAULT_MIME);
    expect(getMimeType("deep/nested/file.bin")).toBe("application/octet-stream");
  });
});
