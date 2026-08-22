import { beforeEach, describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { S3StorageService } from "@/lib/storage/s3-service";
import { NotFoundError, RangeNotSatisfiableError, StorageError } from "@/lib/errors";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, command: { input: { PartNumber?: number } }) =>
      `https://s3.test.internal/signed?partNumber=${command.input.PartNumber ?? 0}`,
  ),
}));

const MB = 1024 * 1024;
const GB = 1024 * MB;

type CommandLike = { constructor: new (...args: never[]) => unknown; input: Record<string, unknown> };

type Route = (input: Record<string, unknown>) => unknown;

function makeClient(routes: Record<string, Route>) {
  const sent: CommandLike[] = [];
  const client = {
    send: vi.fn(async (command: CommandLike) => {
      sent.push(command);
      const name = command.constructor.name;
      const route = routes[name];
      if (!route) throw new Error(`Unexpected command in test: ${name}`);
      return await route(command.input);
    }),
  };
  return { client: client as unknown as S3Client, sent };
}

const service = (client: S3Client) => new S3StorageService(client, "test-bucket");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list", () => {
  it("maps common prefixes to folders and contents to files, folders first", async () => {
    const { client } = makeClient({
      ListObjectsV2Command: () => ({
        IsTruncated: false,
        CommonPrefixes: [{ Prefix: "VMware/" }, { Prefix: "ISO/Linux/" }],
        Contents: [
          { Key: "rhel-9.iso", Size: 10 * GB, LastModified: new Date("2026-08-17T10:00:00Z"), ETag: '"e1"' },
          { Key: "notes.txt", Size: 12, LastModified: new Date("2026-08-01T10:00:00Z") },
        ],
      }),
    });
    const result = await service(client).list("");

    expect(result.prefix).toBe("");
    expect(result.entries.map((e) => `${e.type}:${e.name}`)).toEqual([
      "folder:Linux",
      "folder:VMware",
      "file:notes.txt",
      "file:rhel-9.iso",
    ]);
    const iso = result.entries[3];
    expect(iso.size).toBe(10 * GB);
    expect(iso.lastModified).toBe("2026-08-17T10:00:00.000Z");
    expect(iso.etag).toBe('"e1"');
  });

  it("hides the zero-byte marker of the folder being listed", async () => {
    const { client } = makeClient({
      ListObjectsV2Command: () => ({
        IsTruncated: false,
        CommonPrefixes: [],
        Contents: [
          { Key: "ISO/", Size: 0 }, // marker of the listed folder itself
          { Key: "ISO/", Size: 0 },
          { Key: "ISO/ubuntu.iso", Size: 5 },
        ],
      }),
    });
    const result = await service(client).list("ISO/");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ type: "file", name: "ubuntu.iso" });
  });

  it("treats zero-byte slash-suffixed objects as folders", async () => {
    const { client } = makeClient({
      ListObjectsV2Command: () => ({
        IsTruncated: false,
        Contents: [
          { Key: "empty-folder/", Size: 0, LastModified: new Date("2026-08-20T00:00:00Z") },
        ],
      }),
    });
    const result = await service(client).list("");
    expect(result.entries[0]).toMatchObject({ type: "folder", name: "empty-folder", size: null });
  });

  it("follows continuation tokens until the listing is complete", async () => {
    let page = 0;
    const { client, sent } = makeClient({
      ListObjectsV2Command: (input) => {
        page += 1;
        if (page === 1) {
          expect(input.Prefix).toBe("big/");
          return {
            IsTruncated: true,
            NextContinuationToken: "token-2",
            Contents: [{ Key: "big/a.bin", Size: 1 }],
          };
        }
        expect(input.ContinuationToken).toBe("token-2");
        return {
          IsTruncated: false,
          Contents: [{ Key: "big/b.bin", Size: 2 }],
        };
      },
    });

    const result = await service(client).list("big/");
    expect(page).toBe(2);
    expect(sent).toHaveLength(2);
    expect(result.entries.map((e) => e.name)).toEqual(["a.bin", "b.bin"]);
  });

  it("requests at most 1000 keys per page with a delimiter", async () => {
    const { client, sent } = makeClient({
      ListObjectsV2Command: () => ({ IsTruncated: false, Contents: [] }),
    });
    await service(client).list("x/");
    const input = sent[0].input;
    expect(input.MaxKeys).toBe(1000);
    expect(input.Delimiter).toBe("/");
    expect(input.Prefix).toBe("x/");
  });
});

describe("stat / head / exists", () => {
  it("returns mapped metadata", async () => {
    const { client } = makeClient({
      HeadObjectCommand: () => ({
        ContentLength: 6500000000,
        LastModified: new Date("2026-08-21T00:00:00Z"),
        ETag: '"abc"',
        ContentType: "application/octet-stream",
      }),
    });
    const stat = await service(client).stat("iso/ubuntu.iso");
    expect(stat).toMatchObject({ size: 6500000000, contentType: "application/octet-stream" });
    expect(await service(client).exists("iso/ubuntu.iso")).toBe(true);
  });

  it("returns null when the object does not exist", async () => {
    const { client } = makeClient({
      HeadObjectCommand: () => {
        const err = new Error("nope") as Error & { name: string };
        err.name = "NoSuchKey";
        throw err;
      },
    });
    expect(await service(client).head("missing.iso")).toBeNull();
    expect(await service(client).exists("missing.iso")).toBe(false);
  });
});

describe("get (streaming + range)", () => {
  it("forwards the Range header and reports 206 with content range", async () => {
    const { client, sent } = makeClient({
      GetObjectCommand: () => ({
        Body: Readable.from([Buffer.from("first megabyte")]),
        ContentLength: 14,
        ContentRange: "bytes 0-1048575/6500000000",
        ContentType: "application/octet-stream",
        ETag: '"etag1"',
        LastModified: new Date("2026-08-21T00:00:00Z"),
      }),
    });

    const result = await service(client).get("iso/ubuntu.iso", "bytes=0-1048575");

    expect(sent[0]).toBeInstanceOf(GetObjectCommand);
    expect(sent[0].input.Range).toBe("bytes=0-1048575");
    expect(sent[0].input.Key).toBe("iso/ubuntu.iso");
    expect(result.status).toBe(206);
    expect(result.contentRange).toBe("bytes 0-1048575/6500000000");
    expect(result.contentLength).toBe(14);

    const reader = result.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString()).toBe("first megabyte");
  });

  it("returns status 200 without range", async () => {
    const { client, sent } = makeClient({
      GetObjectCommand: () => ({
        Body: Readable.from([]),
        ContentLength: 0,
        ContentType: "text/plain",
      }),
    });
    const result = await service(client).get("a.txt");
    expect(sent[0].input.Range).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it("maps NoSuchKey to NotFoundError and InvalidRange to 416", async () => {
    const notFound = makeClient({
      GetObjectCommand: () => {
        const err = new Error("gone") as Error & { name: string };
        err.name = "NoSuchKey";
        throw err;
      },
    });
    await expect(service(notFound.client).get("nope.iso")).rejects.toBeInstanceOf(NotFoundError);

    const badRange = makeClient({
      GetObjectCommand: () => {
        const err = new Error("bad") as Error & { name: string };
        err.name = "InvalidRange";
        throw err;
      },
    });
    await expect(service(badRange.client).get("iso.iso", "bytes=999999999-")).rejects.toBeInstanceOf(
      RangeNotSatisfiableError,
    );
  });
});

describe("deleteFile", () => {
  it("deletes exactly the requested key", async () => {
    const { client, sent } = makeClient({ DeleteObjectCommand: () => ({}) });
    await service(client).deleteFile("ISO/old ubuntu.iso");
    expect(sent[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(sent[0].input.Key).toBe("ISO/old ubuntu.iso");
  });
});

describe("deleteFolder", () => {
  it("refuses to delete the bucket root", async () => {
    const { client } = makeClient({});
    await expect(service(client).deleteFolder("")).rejects.toThrow(StorageError);
  });

  it("batch-deletes every object under the prefix including the marker", async () => {
    const keys = ["ISO/", ...Array.from({ length: 2500 }, (_, i) => `ISO/f${i}.bin`)];
    const deleteBatches: number[] = [];
    const { client, sent } = makeClient({
      ListObjectsV2Command: () => ({ IsTruncated: false, Contents: keys.map((Key) => ({ Key })) }),
      DeleteObjectsCommand: (input) => {
        deleteBatches.push((input.Delete as { Objects: unknown[] }).Objects.length);
        return {};
      },
    });

    const deleted = await service(client).deleteFolder("ISO/");
    expect(deleted).toBe(2501);
    expect(deleteBatches).toEqual([1000, 1000, 501]);
    const firstBatch = (sent[1].input.Delete as { Objects: { Key: string }[] }).Objects;
    expect(firstBatch[0].Key).toBe("ISO/");
  });
});

describe("createFolder", () => {
  it("writes a zero-byte directory marker", async () => {
    const { client, sent } = makeClient({ PutObjectCommand: () => ({}) });
    await service(client).createFolder("ISO/new folder/");
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[0].input.Key).toBe("ISO/new folder/");
    expect(sent[0].input.ContentType).toBe("application/x-directory");
  });
});

describe("renameFile (copy + delete)", () => {
  it("copies then deletes for small objects", async () => {
    const { client, sent } = makeClient({
      HeadObjectCommand: () => ({ ContentLength: 5 * MB, ContentType: "text/plain" }),
      CopyObjectCommand: () => ({}),
      DeleteObjectCommand: () => ({}),
    });

    await service(client).renameFile("docs/old name.txt", "docs/new name.txt");

    expect(sent.map((c) => c.constructor.name)).toEqual([
      "HeadObjectCommand",
      "CopyObjectCommand",
      "DeleteObjectCommand",
    ]);
    expect(sent[1].input.CopySource).toBe("test-bucket/docs/old%20name.txt");
    expect(sent[1].input.Key).toBe("docs/new name.txt");
    expect(sent[1].input.MetadataDirective).toBe("COPY");
  });

  it("is a no-op when source equals target", async () => {
    const { client, sent } = makeClient({});
    await service(client).renameFile("same.txt", "same.txt");
    expect(sent).toHaveLength(0);
  });

  it("throws NotFoundError when the source is missing", async () => {
    const { client } = makeClient({
      HeadObjectCommand: () => {
        const err = new Error("nope") as Error & { name: string };
        err.name = "NotFound";
        throw err;
      },
    });
    await expect(service(client).renameFile("a", "b")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("uses multipart copy for large objects (RGW/AWS copy limits)", async () => {
    const size = 600 * MB; // above the single-copy threshold
    const partSize = 128 * MB;
    const { client, sent } = makeClient({
      HeadObjectCommand: () => ({ ContentLength: size, ContentType: "application/x-iso" }),
      CreateMultipartUploadCommand: () => ({ UploadId: "mpu-1" }),
      UploadPartCopyCommand: (input) => ({
        CopyPartResult: { ETag: `"part-${input.PartNumber}"` },
      }),
      CompleteMultipartUploadCommand: () => ({ ETag: '"done"' }),
      DeleteObjectCommand: () => ({}),
    });

    await service(client).renameFile("iso/big.iso", "iso/big-renamed.iso");

    const copies = sent.filter((c) => c instanceof UploadPartCopyCommand);
    expect(copies).toHaveLength(Math.ceil(size / partSize));
    expect(copies[0].input.CopySourceRange).toBe(`bytes=0-${partSize - 1}`);
    const last = copies[copies.length - 1].input.CopySourceRange as string;
    expect(last.endsWith(`-${size - 1}`)).toBe(true);

    const complete = sent.find((c) => c instanceof CompleteMultipartUploadCommand)!;
    const parts = (complete.input.MultipartUpload as { Parts: unknown[] }).Parts;
    expect(parts).toHaveLength(copies.length);

    // Original removed only after the copy completed.
    expect(sent[sent.length - 1]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("aborts the multipart copy when a part fails", async () => {
    const { client, sent } = makeClient({
      HeadObjectCommand: () => ({ ContentLength: 600 * MB }),
      CreateMultipartUploadCommand: () => ({ UploadId: "mpu-x" }),
      UploadPartCopyCommand: () => {
        throw new Error("boom");
      },
      AbortMultipartUploadCommand: () => ({}),
    });

    await expect(service(client).renameFile("a.iso", "b.iso")).rejects.toBeInstanceOf(
      StorageError,
    );
    expect(sent.some((c) => c.constructor.name === "AbortMultipartUploadCommand")).toBe(true);
    // Source must remain untouched.
    expect(sent.some((c) => c instanceof DeleteObjectCommand)).toBe(false);
  });
});

describe("renameFolder", () => {
  it("copies all objects first, then removes originals in batches", async () => {
    const keys = ["src/", "src/a.bin", "src/sub/", "src/sub/b.bin"];
    const { client, sent } = makeClient({
      ListObjectsV2Command: () => ({ IsTruncated: false, Contents: keys.map((Key) => ({ Key })) }),
      HeadObjectCommand: () => ({ ContentLength: 1024 }),
      CopyObjectCommand: () => ({}),
      DeleteObjectsCommand: () => ({}),
    });

    const renamed = await service(client).renameFolder("src/", "dst/");
    expect(renamed).toBe(4);

    const copyTargets = sent
      .filter((c) => c instanceof CopyObjectCommand)
      .map((c) => c.input.Key)
      .sort();
    expect(copyTargets).toEqual(["dst/", "dst/a.bin", "dst/sub/", "dst/sub/b.bin"]);

    const firstDeleteIndex = sent.findIndex((c) => c instanceof DeleteObjectsCommand);
    const lastCopyIndex = sent.reduce(
      (acc, c, i) => (c instanceof CopyObjectCommand ? i : acc),
      -1,
    );
    expect(firstDeleteIndex).toBeGreaterThan(lastCopyIndex);

    const deletedKeys = (
      sent[firstDeleteIndex].input.Delete as { Objects: { Key: string }[] }
    ).Objects.map((o) => o.Key);
    expect(deletedKeys.sort()).toEqual([...keys].sort());
  });

  it("refuses renaming a folder into its own subtree", async () => {
    const { client } = makeClient({});
    await expect(service(client).renameFolder("a/", "a/b/")).rejects.toThrow(StorageError);
  });
});

describe("multipart upload API", () => {
  it("creates an upload and returns the upload id", async () => {
    const { client, sent } = makeClient({
      CreateMultipartUploadCommand: () => ({ UploadId: "mpu-42" }),
    });
    const result = await service(client).createMultipartUpload("iso/x.iso", "application/octet-stream");
    expect(result.uploadId).toBe("mpu-42");
    expect(sent[0].input.ContentType).toBe("application/octet-stream");
  });

  it("signs each requested part", async () => {
    const { client } = makeClient({});
    const result = await service(client).presignParts("iso/x.iso", "mpu-42", [1, 2, 3]);
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toEqual({
      partNumber: 1,
      url: "https://s3.test.internal/signed?partNumber=1",
    });
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes with sorted parts and stripped ETag quotes", async () => {
    const { client, sent } = makeClient({
      CompleteMultipartUploadCommand: () => ({ ETag: '"overall"' }),
    });
    const result = await service(client).completeMultipartUpload("iso/x.iso", "mpu-42", [
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 1, etag: 'e1' },
    ]);

    expect(result.etag).toBe('"overall"');
    const parts = (sent[0].input.MultipartUpload as { Parts: { PartNumber: number; ETag: string }[] })
      .Parts;
    expect(parts).toEqual([
      { PartNumber: 1, ETag: "e1" },
      { PartNumber: 2, ETag: "e2" },
    ]);
  });

  it("rejects completion without parts", async () => {
    const { client } = makeClient({});
    await expect(service(client).completeMultipartUpload("k", "id", [])).rejects.toThrow(
      StorageError,
    );
  });

  it("aborts uploads and swallows backend errors", async () => {
    const ok = makeClient({ AbortMultipartUploadCommand: () => ({}) });
    await service(ok.client).abortMultipartUpload("k", "id");
    expect(ok.sent[0].constructor.name).toBe("AbortMultipartUploadCommand");

    const failing = makeClient({
      AbortMultipartUploadCommand: () => {
        throw new Error("already gone");
      },
    });
    await expect(service(failing.client).abortMultipartUpload("k", "id")).resolves.toBeUndefined();
  });
});

describe("search", () => {
  const page = (contents: { Key: string; Size?: number }[], truncated = false) => ({
    IsTruncated: truncated,
    Contents: contents.map((c) => ({ ...c, LastModified: new Date("2026-08-21T00:00:00Z") })),
  });

  it("matches files and folder markers at any depth, folders first", async () => {
    const { client, sent } = makeClient({
      ListObjectsV2Command: () =>
        page([
          { Key: "ISO/ubuntu-22.04.iso", Size: 10 },
          { Key: "ISO/", Size: 0 },
          { Key: "docs/unrelated.txt", Size: 1 },
          { Key: "tools/ubuntu-upgrade.sh", Size: 2 },
          { Key: "old/ubuntu/", Size: 0 },
        ]),
    });
    const result = await service(client).search("UBUNTU");

    // Case-insensitive; scope marker of the searched prefix itself excluded.
    expect(sent[0].input.Prefix).toBeUndefined();
    expect(result.hits.map((h) => `${h.type}:${h.name}`)).toEqual([
      "folder:ubuntu",
      "file:ubuntu-22.04.iso",
      "file:ubuntu-upgrade.sh",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("scopes the search under a prefix and reports parent folders", async () => {
    const { client, sent } = makeClient({
      ListObjectsV2Command: () => page([{ Key: "ISO/Linux/ubuntu.iso", Size: 3 }]),
    });
    const result = await service(client).search("ubuntu", "ISO/");

    expect(sent[0].input.Prefix).toBe("ISO/");
    expect(result.prefix).toBe("ISO/");
    expect(result.hits[0]).toMatchObject({
      key: "ISO/Linux/ubuntu.iso",
      name: "ubuntu.iso",
      type: "file",
      folder: "ISO/Linux",
    });
  });

  it("returns an empty result for blank queries without touching S3", async () => {
    const { client } = makeClient({});
    const result = await service(client).search("   ");
    expect(result.hits).toEqual([]);
    expect(result.query).toBe("   ");
  });

  it("follows pagination until results run out", async () => {
    let call = 0;
    const { client } = makeClient({
      ListObjectsV2Command: () => {
        call += 1;
        return call === 1
          ? { IsTruncated: true, NextContinuationToken: "t2", Contents: [{ Key: "a/one.bin", Size: 1, LastModified: new Date() }] }
          : { IsTruncated: false, Contents: [{ Key: "a/two.bin", Size: 1, LastModified: new Date() }] };
      },
    });
    const result = await service(client).search(".bin");
    expect(result.hits.map((h) => h.name)).toEqual(["one.bin", "two.bin"]);
  });

  it("marks results as truncated when the hit cap is reached", async () => {
    const contents = Array.from({ length: 250 }, (_, i) => ({
      Key: `f/match-${String(i).padStart(3, "0")}.bin`,
      Size: 1,
    }));
    const { client } = makeClient({ ListObjectsV2Command: () => page(contents) });
    const result = await service(client).search("match");
    expect(result.hits).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });
});
