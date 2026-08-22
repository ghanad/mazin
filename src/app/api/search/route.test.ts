import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ storage: {} as Record<string, ReturnType<typeof vi.fn>> }));

vi.mock("@/lib/storage", () => ({
  getStorage: () => mocks.storage,
}));

import { GET } from "@/app/api/search/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage = {
    search: vi.fn(),
  };
});

describe("GET /api/search", () => {
  it("searches recursively and attaches download URLs to file hits", async () => {
    mocks.storage.search.mockResolvedValue({
      query: "ubuntu",
      prefix: "",
      truncated: false,
      hits: [
        {
          key: "ISO/ubuntu-24.04.iso",
          name: "ubuntu-24.04.iso",
          type: "file",
          size: 5,
          lastModified: "2026-08-21T00:00:00.000Z",
          folder: "ISO",
        },
        {
          key: "old/ubuntu",
          name: "ubuntu",
          type: "folder",
          size: null,
          lastModified: null,
          folder: "",
        },
      ],
    });

    const res = await GET(new NextRequest("https://files.internal.example.com/api/search?q=ubuntu"));
    const body = (await res.json()) as {
      query: string;
      hits: { name: string; url?: string; type: string }[];
    };

    expect(res.status).toBe(200);
    expect(mocks.storage.search).toHaveBeenCalledWith("ubuntu", "");
    expect(body.hits[0].url).toBe("https://files.internal.example.com/files/ISO/ubuntu-24.04.iso");
    expect(body.hits[1].url).toBeUndefined();
  });

  it("passes the scope prefix through", async () => {
    mocks.storage.search.mockResolvedValue({ query: "a", prefix: "ISO/", hits: [], truncated: false });
    const res = await GET(new NextRequest("https://x.test/api/search?q=a&prefix=ISO"));
    expect(res.status).toBe(200);
    expect(mocks.storage.search).toHaveBeenCalledWith("a", "ISO/");
  });

  it("requires a query (400)", async () => {
    const res = await GET(new NextRequest("https://x.test/api/search?q=%20%20"));
    expect(res.status).toBe(400);
    expect(mocks.storage.search).not.toHaveBeenCalled();
  });

  it("rejects overlong queries (400)", async () => {
    const res = await GET(new NextRequest(`https://x.test/api/search?q=${"x".repeat(256)}`));
    expect(res.status).toBe(400);
    expect(mocks.storage.search).not.toHaveBeenCalled();
  });

  it("rejects invalid prefixes with 400", async () => {
    const res = await GET(new NextRequest("https://x.test/api/search?q=a&prefix=..%2Fetc"));
    expect(res.status).toBe(400);
    expect(mocks.storage.search).not.toHaveBeenCalled();
  });

  it("maps storage failures to safe JSON errors", async () => {
    mocks.storage.search.mockRejectedValue(new Error("boom"));
    const res = await GET(new NextRequest("https://x.test/api/search?q=a"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Internal server error");
  });
});
