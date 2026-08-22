import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ storage: {} as Record<string, ReturnType<typeof vi.fn>> }));

vi.mock("@/lib/storage", () => ({
  getStorage: () => mocks.storage,
}));

import { DELETE, GET } from "@/app/api/files/route";
import { GET as getText, PUT as putText } from "@/app/api/files/text/route";
import { POST as renameRoute } from "@/app/api/files/rename/route";

function jsonRequest(method: string, body: unknown) {
  return new NextRequest("https://files.internal.example.com/api/files", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage = {
    list: vi.fn(),
    head: vi.fn(),
    get: vi.fn(),
    putText: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFolder: vi.fn().mockResolvedValue(3),
    renameFile: vi.fn().mockResolvedValue(undefined),
    renameFolder: vi.fn().mockResolvedValue(5),
  };
});

describe("GET /api/files", () => {
  it("lists a folder and builds stable direct URLs", async () => {
    mocks.storage.list.mockResolvedValue({
      prefix: "ISO/Linux/",
      entries: [
        { key: "ISO/Linux/debian", name: "debian", type: "folder", size: null, lastModified: null },
        {
          key: "ISO/Linux/ubuntu 24.04.iso",
          name: "ubuntu 24.04.iso",
          type: "file",
          size: 6500000000,
          lastModified: "2026-08-21T00:00:00.000Z",
        },
      ],
    });

    const request = new NextRequest(
      "https://files.internal.example.com/api/files?prefix=ISO%2FLinux",
    );
    const res = await GET(request);
    const body = (await res.json()) as {
      prefix: string;
      entries: { name: string; url?: string }[];
    };

    expect(res.status).toBe(200);
    expect(body.prefix).toBe("ISO/Linux/");
    expect(mocks.storage.list).toHaveBeenCalledWith("ISO/Linux/");
    expect(body.entries[0].url).toBeUndefined(); // folders have no download URL
    expect(body.entries[1].url).toBe(
      "https://files.internal.example.com/files/ISO/Linux/ubuntu%2024.04.iso",
    );
  });

  it("encodes unicode (Persian) filenames in direct URLs", async () => {
    mocks.storage.list.mockResolvedValue({
      prefix: "",
      entries: [
        {
          key: "نسخه-نهایی.iso",
          name: "نسخه-نهایی.iso",
          type: "file",
          size: 1,
          lastModified: null,
        },
      ],
    });

    const res = await GET(new NextRequest("https://x.test/api/files"));
    const body = (await res.json()) as { entries: { url?: string }[] };
    expect(body.entries[0].url).toBe(
      `https://files.internal.example.com/files/${encodeURIComponent("نسخه-نهایی.iso")}`,
    );
  });

  it("rejects invalid prefixes with 400", async () => {
    const res = await GET(new NextRequest("https://x.test/api/files?prefix=..%2Fetc"));
    expect(res.status).toBe(400);
  });
});

describe("/api/files/text", () => {
  it("retrieves bounded valid UTF-8 text", async () => {
    mocks.storage.head.mockResolvedValue({ key: "notes.txt", size: 5, lastModified: new Date("2026-08-21T00:00:00Z"), etag: '"one"', contentType: "text/plain" });
    mocks.storage.get.mockResolvedValue({ status: 206, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("hello")); controller.close(); } }), contentRange: "bytes 0-4/5", contentType: "text/plain" });
    const res = await getText(new NextRequest("https://x.test/api/files/text?key=notes.txt"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: "notes.txt", content: "hello", etag: '"one"' });
    expect(mocks.storage.get).toHaveBeenCalledWith("notes.txt", "bytes=0-1048575");
  });

  it("rejects invalid keys and binary/oversized content", async () => {
    expect((await getText(new NextRequest("https://x.test/api/files/text?key=../secret.txt"))).status).toBe(400);
    mocks.storage.head.mockResolvedValue({ key: "image.bin", size: 2, lastModified: new Date(), etag: '"x"', contentType: "application/octet-stream" });
    mocks.storage.get.mockResolvedValue({ status: 206, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0, 1])); controller.close(); } }), contentRange: "bytes 0-1/2", contentType: "application/octet-stream" });
    expect((await getText(new NextRequest("https://x.test/api/files/text?key=image.bin"))).status).toBe(400);
    mocks.storage.head.mockResolvedValue({ key: "large.txt", size: 1048577, lastModified: new Date(), etag: '"x"', contentType: "text/plain" });
    expect((await getText(new NextRequest("https://x.test/api/files/text?key=large.txt"))).status).toBe(400);
  });

  it("returns 404 for missing files and 400 for invalid UTF-8", async () => {
    mocks.storage.head.mockResolvedValue(null);
    expect((await getText(new NextRequest("https://x.test/api/files/text?key=missing.txt"))).status).toBe(404);
    mocks.storage.head.mockResolvedValue({ key: "bad.txt", size: 2, lastModified: new Date(), etag: '"x"', contentType: "text/plain" });
    mocks.storage.get.mockResolvedValue({ status: 206, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); controller.close(); } }), contentRange: "bytes 0-1/2", contentType: "text/plain" });
    expect((await getText(new NextRequest("https://x.test/api/files/text?key=bad.txt"))).status).toBe(400);
  });

  it("saves with the expected ETag and maps conflicts to 409", async () => {
    mocks.storage.head.mockResolvedValue({ key: "notes.txt", size: 5, lastModified: new Date(), etag: '"one"', contentType: "text/plain" });
    mocks.storage.putText.mockResolvedValue({ key: "notes.txt", size: 3, lastModified: new Date(), etag: '"two"', contentType: "text/plain" });
    const res = await putText(jsonRequest("PUT", { key: "notes.txt", content: "hey", expectedEtag: '"one"' }));
    expect(res.status).toBe(200);
    expect(mocks.storage.putText).toHaveBeenCalledWith("notes.txt", expect.any(Uint8Array), "text/plain", '"one"');
    const { ConflictError } = await import("@/lib/errors");
    mocks.storage.putText.mockRejectedValue(new ConflictError("changed"));
    expect((await putText(jsonRequest("PUT", { key: "notes.txt", content: "new", expectedEtag: '"one"' }))).status).toBe(409);
  });

  it("infers a missing stored MIME from the key when saving", async () => {
    mocks.storage.head.mockResolvedValue({ key: "config.json", size: 2, lastModified: new Date(), etag: '"one"' });
    mocks.storage.putText.mockResolvedValue({ key: "config.json", size: 2, lastModified: new Date(), etag: '"two"', contentType: "application/json" });
    await putText(jsonRequest("PUT", { key: "config.json", content: "{}", expectedEtag: '"one"' }));
    expect(mocks.storage.putText).toHaveBeenCalledWith("config.json", expect.any(Uint8Array), "application/json", '"one"');
  });
});

describe("DELETE /api/files", () => {
  it("deletes a file", async () => {
    const res = await DELETE(jsonRequest("DELETE", { key: "a.txt", type: "file" }));
    expect(res.status).toBe(200);
    expect(mocks.storage.deleteFile).toHaveBeenCalledWith("a.txt");
  });

  it("deletes a folder recursively", async () => {
    const res = await DELETE(jsonRequest("DELETE", { key: "ISO/Old stuff", type: "folder" }));
    expect(res.status).toBe(200);
    expect(mocks.storage.deleteFolder).toHaveBeenCalledWith("ISO/Old stuff/");
  });

  it("refuses to delete the bucket root", async () => {
    const res = await DELETE(jsonRequest("DELETE", { key: "", type: "folder" }));
    expect(res.status).toBe(400);
    expect(mocks.storage.deleteFolder).not.toHaveBeenCalled();
  });

  it("rejects traversal keys", async () => {
    const res = await DELETE(jsonRequest("DELETE", { key: "../escape", type: "file" }));
    expect(res.status).toBe(400);
    expect(mocks.storage.deleteFile).not.toHaveBeenCalled();
  });
});

describe("POST /api/files/rename", () => {
  it("renames a file within its folder", async () => {
    const res = await renameRoute(
      jsonRequest("POST", { from: "docs/old name.txt", to: "new name.txt", isFolder: false }),
    );
    expect(res.status).toBe(200);
    expect(mocks.storage.renameFile).toHaveBeenCalledWith(
      "docs/old name.txt",
      "docs/new name.txt",
    );
  });

  it("renames a folder prefix", async () => {
    const res = await renameRoute(
      jsonRequest("POST", { from: "ISO/Linux", to: "Debian", isFolder: true }),
    );
    expect(res.status).toBe(200);
    expect(mocks.storage.renameFolder).toHaveBeenCalledWith("ISO/Linux/", "ISO/Debian/");
  });

  it("returns 409 when the target exists and overwrite is not set", async () => {
    mocks.storage.exists.mockResolvedValue(true);
    const res = await renameRoute(
      jsonRequest("POST", { from: "a.txt", to: "b.txt", isFolder: false }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { exists?: boolean };
    expect(body.exists).toBe(true);
    expect(mocks.storage.renameFile).not.toHaveBeenCalled();
  });

  it("overwrites when explicitly requested", async () => {
    mocks.storage.exists.mockResolvedValue(true);
    const res = await renameRoute(
      jsonRequest("POST", { from: "a.txt", to: "b.txt", isFolder: false, overwrite: true }),
    );
    expect(res.status).toBe(200);
    expect(mocks.storage.renameFile).toHaveBeenCalled();
  });
});
