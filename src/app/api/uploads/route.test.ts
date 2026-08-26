import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ storage: {} as Record<string, ReturnType<typeof vi.fn>> }));

vi.mock("@/lib/storage", () => ({
  getStorage: () => mocks.storage,
}));

import { POST as createFolderRoute } from "@/app/api/folders/route";
import { POST as createUploadRoute } from "@/app/api/uploads/create/route";
import { POST as presignPartRoute } from "@/app/api/uploads/presign-part/route";
import { POST as completeRoute } from "@/app/api/uploads/complete/route";
import { POST as abortRoute } from "@/app/api/uploads/abort/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { GET as readyRoute } from "@/app/api/health/ready/route";
import { GET as cliCapabilitiesRoute } from "@/app/api/cli/capabilities/route";

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(`https://files.internal.example.com${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage = {
    exists: vi.fn().mockResolvedValue(false),
    createFolder: vi.fn().mockResolvedValue(undefined),
    presignPut: vi.fn().mockResolvedValue({ url: "https://s3.test.internal/put", expiresInSeconds: 3600 }),
    createMultipartUpload: vi.fn().mockResolvedValue({ uploadId: "mpu-1" }),
    presignParts: vi
      .fn()
      .mockResolvedValue({
        parts: [
          { partNumber: 1, url: "https://s3.test.internal/p1" },
          { partNumber: 2, url: "https://s3.test.internal/p2" },
        ],
        expiresInSeconds: 3600,
      }),
    completeMultipartUpload: vi.fn().mockResolvedValue({ etag: '"all"' }),
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    checkReadiness: vi.fn().mockResolvedValue(undefined),
  };
});

describe("GET /api/cli/capabilities", () => {
  it("advertises the versioned directory-upload capability", async () => {
    const res = await cliCapabilitiesRoute(new Request("https://files.internal.example.com/api/cli/capabilities"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      uploadProtocolVersion: 1,
      features: ["directory-upload"],
      downloadUrl: "https://files.internal.example.com/file-server-upload.py",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/folders", () => {
  it("creates a folder marker", async () => {
    const res = await createFolderRoute(jsonRequest("/api/folders", { prefix: "ISO", name: "New distros" }));
    expect(res.status).toBe(200);
    expect(mocks.storage.createFolder).toHaveBeenCalledWith("ISO/New distros/");
  });

  it("returns 409 when the folder already exists", async () => {
    mocks.storage.exists.mockResolvedValue(true);
    const res = await createFolderRoute(jsonRequest("/api/folders", { prefix: "", name: "x" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { exists?: boolean };
    expect(body.exists).toBe(true);
  });

  it("rejects invalid names", async () => {
    const res = await createFolderRoute(jsonRequest("/api/folders", { prefix: "", name: "a/b" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/uploads/create", () => {
  it("returns a single presigned PUT for small files", async () => {
    const res = await createUploadRoute(
      jsonRequest("/api/uploads/create", {
        prefix: "docs",
        name: "notes.txt",
        size: 1024,
        contentType: "text/plain",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; url: string };
    expect(body.mode).toBe("single");
    expect(body.url).toBe("https://s3.test.internal/put");
    expect(mocks.storage.presignPut).toHaveBeenCalledWith("docs/notes.txt", "text/plain");
    expect(mocks.storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("initializes multipart upload with presigned parts for large files", async () => {
    const res = await createUploadRoute(
      jsonRequest("/api/uploads/create", {
        prefix: "",
        name: "big.iso",
        size: 100 * 1024 * 1024,
        contentType: "application/octet-stream",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      uploadId: string;
      partSize: number;
      parts: { partNumber: number }[];
    };
    expect(body.mode).toBe("multipart");
    expect(body.uploadId).toBe("mpu-1");
    expect(body.partSize).toBe(64 * 1024 * 1024);
    expect(body.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(mocks.storage.presignParts).toHaveBeenCalledWith("big.iso", "mpu-1", [1, 2]);
  });

  it("returns 409 on existing target unless overwrite is set", async () => {
    mocks.storage.exists.mockResolvedValue(true);
    const conflict = await createUploadRoute(
      jsonRequest("/api/uploads/create", { prefix: "", name: "a.bin", size: 10 }),
    );
    expect(conflict.status).toBe(409);

    const overwrite = await createUploadRoute(
      jsonRequest("/api/uploads/create", { prefix: "", name: "a.bin", size: 10, overwrite: true }),
    );
    expect(overwrite.status).toBe(200);
  });

  it("validates size input", async () => {
    const res = await createUploadRoute(
      jsonRequest("/api/uploads/create", { prefix: "", name: "x", size: -5 }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/uploads/presign-part", () => {
  it("re-signs requested parts", async () => {
    const res = await presignPartRoute(
      jsonRequest("/api/uploads/presign-part", {
        key: "big.iso",
        uploadId: "mpu-1",
        partNumbers: [3, 4],
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.storage.presignParts).toHaveBeenCalledWith("big.iso", "mpu-1", [3, 4]);
  });

  it("rejects invalid part numbers", async () => {
    const res = await presignPartRoute(
      jsonRequest("/api/uploads/presign-part", {
        key: "big.iso",
        uploadId: "mpu-1",
        partNumbers: [0],
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/uploads/complete", () => {
  it("completes with validated parts", async () => {
    const res = await completeRoute(
      jsonRequest("/api/uploads/complete", {
        key: "big.iso",
        uploadId: "mpu-1",
        parts: [
          { partNumber: 2, etag: ' "e2" ' },
          { partNumber: 1, etag: '"e1"' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.storage.completeMultipartUpload).toHaveBeenCalledWith("big.iso", "mpu-1", [
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 1, etag: '"e1"' },
    ]);
  });

  it("rejects empty or malformed parts", async () => {
    const empty = await completeRoute(
      jsonRequest("/api/uploads/complete", { key: "k", uploadId: "id", parts: [] }),
    );
    expect(empty.status).toBe(400);

    const malformed = await completeRoute(
      jsonRequest("/api/uploads/complete", {
        key: "k",
        uploadId: "id",
        parts: [{ partNumber: 1 }],
      }),
    );
    expect(malformed.status).toBe(400);
  });
});

describe("POST /api/uploads/abort", () => {
  it("aborts the multipart session", async () => {
    const res = await abortRoute(
      jsonRequest("/api/uploads/abort", { key: "big.iso", uploadId: "mpu-1" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.storage.abortMultipartUpload).toHaveBeenCalledWith("big.iso", "mpu-1");
  });

  it("requires key and uploadId", async () => {
    const res = await abortRoute(jsonRequest("/api/uploads/abort", { key: "big.iso" }));
    expect(res.status).toBe(400);
  });
});

describe("health endpoints", () => {
  it("GET /api/health is always ok", async () => {
    const res = await healthRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/health/ready reports storage readiness", async () => {
    const ok = await readyRoute();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ok", storage: "ready" });

    mocks.storage.checkReadiness.mockRejectedValue(new Error("down"));
    const failing = await readyRoute();
    expect(failing.status).toBe(503);
  });
});
