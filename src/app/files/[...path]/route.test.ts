import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NotFoundError, RangeNotSatisfiableError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ storage: {} as Record<string, ReturnType<typeof vi.fn>> }));

vi.mock("@/lib/storage", () => ({
  getStorage: () => mocks.storage,
}));

import { GET, HEAD } from "@/app/files/[...path]/route";

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function requestFor(path: string[], headers: Record<string, string> = {}, method = "GET") {
  const url = `https://files.internal.example.com/files/${path.map(encodeURIComponent).join("/")}`;
  return new NextRequest(url, { method, headers });
}

const context = (path: string[]) => ({
  params: Promise.resolve({ path }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage = {
    get: vi.fn(),
    head: vi.fn(),
  };
});

describe("GET /files/[...path]", () => {
  it("streams the object with correct headers", async () => {
    mocks.storage.get.mockResolvedValue({
      status: 200,
      body: streamOf("ISO-CONTENT"),
      contentLength: 11,
      contentType: "application/octet-stream",
      etag: '"abc123"',
      lastModified: new Date("2026-08-21T12:00:00Z"),
    });

    const res = await GET(requestFor(["iso", "ubuntu-24.04.iso"]), context(["iso", "ubuntu-24.04.iso"]));

    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe("11");
    expect(res.headers.get("ETag")).toBe('"abc123"');
    expect(res.headers.get("Last-Modified")).toContain("2026");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''");

    const text = await new Response(res.body).text();
    expect(text).toBe("ISO-CONTENT");

    expect(mocks.storage.get).toHaveBeenCalledWith("iso/ubuntu-24.04.iso", undefined);
  });

  it("returns 206 Partial Content for a byte range", async () => {
    mocks.storage.get.mockResolvedValue({
      status: 206,
      body: streamOf("a".repeat(1024)),
      contentLength: 1024,
      contentRange: "bytes 0-1023/6500000000",
      contentType: "application/octet-stream",
    });

    const res = await GET(
      requestFor(["iso", "ubuntu.iso"], { Range: "bytes=0-1023" }),
      context(["iso", "ubuntu.iso"]),
    );

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-1023/6500000000");
    expect(res.headers.get("Content-Length")).toBe("1024");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(mocks.storage.get).toHaveBeenCalledWith("iso/ubuntu.iso", "bytes=0-1023");
  });

  it("ignores multi-range requests and serves the full object", async () => {
    mocks.storage.get.mockResolvedValue({
      status: 200,
      body: streamOf("full"),
      contentLength: 4,
      contentType: "application/octet-stream",
    });

    const res = await GET(
      requestFor(["a.bin"], { Range: "bytes=0-1,5-6" }),
      context(["a.bin"]),
    );

    expect(mocks.storage.get).toHaveBeenCalledWith("a.bin", undefined);
    expect(res.status).toBe(200);
  });

  it("returns a plain 404 for missing objects", async () => {
    mocks.storage.get.mockRejectedValue(new NotFoundError("Object not found"));
    const res = await GET(requestFor(["nope.iso"]), context(["nope.iso"]));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  it("returns 416 when the range is not satisfiable", async () => {
    mocks.storage.get.mockRejectedValue(new RangeNotSatisfiableError());
    const res = await GET(
      requestFor(["iso.iso"], { Range: "bytes=999999999-" }),
      context(["iso.iso"]),
    );
    expect(res.status).toBe(416);
  });

  it("returns 404 for invalid keys (path traversal)", async () => {
    const res = await GET(requestFor(["..%2F..%2Fetc"]), context(["..", "..", "etc"]));
    expect(res.status).toBe(404);
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it("returns 502 on storage failures without leaking details", async () => {
    mocks.storage.get.mockRejectedValue(new Error("Connection reset by peer"));
    const res = await GET(requestFor(["a.bin"]), context(["a.bin"]));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("Connection reset");
  });
});

describe("HEAD /files/[...path]", () => {
  it("returns metadata without transferring the body", async () => {
    mocks.storage.head.mockResolvedValue({
      key: "iso/ubuntu.iso",
      size: 6500000000,
      lastModified: new Date("2026-08-21T00:00:00Z"),
      etag: '"deadbeef"',
      contentType: "application/octet-stream",
    });

    const res = await HEAD(requestFor(["iso", "ubuntu.iso"], {}, "HEAD"), context(["iso", "ubuntu.iso"]));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("6500000000");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("ETag")).toBe('"deadbeef"');
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.body).toBeNull();
    // Metadata only: the object body is never fetched.
    expect(mocks.storage.head).toHaveBeenCalledWith("iso/ubuntu.iso");
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it("answers HEAD with Range semantics computed locally", async () => {
    mocks.storage.head.mockResolvedValue({
      key: "big.iso",
      size: 1000000,
      lastModified: new Date(),
      contentType: "application/octet-stream",
    });

    const res = await HEAD(
      requestFor(["big.iso"], { Range: "bytes=100-199" }, "HEAD"),
      context(["big.iso"]),
    );

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 100-199/1000000");
    expect(res.headers.get("Content-Length")).toBe("100");
  });

  it("returns 404 for missing objects", async () => {
    mocks.storage.head.mockResolvedValue(null);
    const res = await HEAD(requestFor(["gone.iso"], {}, "HEAD"), context(["gone.iso"]));
    expect(res.status).toBe(404);
  });
});
