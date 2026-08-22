import { describe, expect, it } from "vitest";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * End-to-end harness for public/file-server-upload.py.
 *
 * An in-process fake implements the four orchestration endpoints plus a
 * pretend S3 that accepts the presigned PUTs, so the real script runs
 * unmodified against it. The suite is skipped automatically when python3
 * is not installed.
 */

const SCRIPT_PATH = path.resolve(__dirname, "../../../public/file-server-upload.py");
const hasPython = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

interface PutRecord {
  uploadId?: string;
  partNumber?: number;
  token: string;
  body: Buffer;
}

interface FakeRecords {
  creates: Record<string, unknown>[];
  presigns: Record<string, unknown>[];
  completes: Record<string, unknown>[];
  aborts: Record<string, unknown>[];
  puts: PutRecord[]; // successful PUTs only
}

interface FakeServer {
  url: string;
  records: FakeRecords;
  close: () => Promise<void>;
}

interface FakeConfig {
  /** Files at or above this size are answered with mode "multipart". */
  multipartThreshold: number;
  partSize: number;
  /** First N PUT attempts of this part answer 500, later ones succeed. */
  failPartAttempts?: { partNumber: number; attempts: number };
  /** Every PUT of these parts answers 500 forever. */
  failPartsAlways?: number[];
  /** Create returns 409 for these names unless overwrite is set. */
  conflictNames?: string[];
  /** Hold the first PUT open until an abort arrives or the test releases it. */
  hangFirstPut?: boolean;
}

function startFakeServer(config: FakeConfig): Promise<FakeServer> {
  const records: FakeRecords = {
    creates: [],
    presigns: [],
    completes: [],
    aborts: [],
    puts: [],
  };

  let uploadSeq = 0;
  let tokenSeq = 0;
  let hungFirstPut = false;
  const partAttempts = new Map<number, number>();
  const hungResponses = new Set<ServerResponse>();

  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const json = (res: ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  const mintSignedUrl = (
    host: string,
    partNumber: number | null,
    uploadId: string | null,
  ) => {
    const token = `tok-${++tokenSeq}`;
    return `${host}/s3/upload?part=${partNumber ?? ""}&uploadId=${encodeURIComponent(uploadId ?? "")}&tok=${token}&X-Amz-Signature=secret-${token}`;
  };

  const shouldFailPut = (partNumber: number | undefined): boolean => {
    if (partNumber === undefined) return false;
    if (config.failPartsAlways?.includes(partNumber)) return true;
    const rule = config.failPartAttempts;
    if (rule?.partNumber === partNumber) {
      const seen = (partAttempts.get(partNumber) ?? 0) + 1;
      partAttempts.set(partNumber, seen);
      return seen <= rule.attempts;
    }
    return false;
  };

  const server: Server = createServer(async (req, res) => {
    const pathname = (req.url ?? "").split("?")[0];
    // Presigned URLs are absolute in production; derive the fake origin from
    // the request the same way.
    const host = `http://${req.headers.host ?? "127.0.0.1"}`;

    if (req.method === "POST" && pathname === "/api/uploads/create") {
      const body = JSON.parse((await readBody(req)).toString("utf8")) as {
        prefix: string;
        name: string;
        size: number;
        contentType?: string;
        overwrite?: boolean;
      };
      records.creates.push(body);

      if ((config.conflictNames ?? []).includes(body.name) && !body.overwrite) {
        json(res, 409, { error: `A file named "${body.name}" already exists`, exists: true });
        return;
      }

      const key = body.prefix ? `${body.prefix}/${body.name}` : body.name;

      if (body.size < config.multipartThreshold) {
        json(res, 200, {
          mode: "single",
          key,
          url: mintSignedUrl(host, null, null),
          expiresInSeconds: 3600,
        });
        return;
      }

      const uploadId = `mpu-${++uploadSeq}`;
      const partCount = Math.max(1, Math.ceil(body.size / config.partSize));
      json(res, 200, {
        mode: "multipart",
        key,
        uploadId,
        partSize: config.partSize,
        parts: Array.from({ length: partCount }, (_, i) => ({
          partNumber: i + 1,
          url: mintSignedUrl(host, i + 1, uploadId),
        })),
        expiresInSeconds: 3600,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/uploads/presign-part") {
      const body = JSON.parse((await readBody(req)).toString("utf8")) as {
        key: string;
        uploadId: string;
        partNumbers: number[];
      };
      records.presigns.push(body);
      json(res, 200, {
        parts: body.partNumbers.map((n) => ({
          partNumber: n,
          url: mintSignedUrl(host, n, body.uploadId),
        })),
        expiresInSeconds: 3600,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/uploads/complete") {
      records.completes.push(JSON.parse((await readBody(req)).toString("utf8")));
      json(res, 200, { ok: true, etag: '"final"' });
      return;
    }

    if (req.method === "POST" && pathname === "/api/uploads/abort") {
      records.aborts.push(JSON.parse((await readBody(req)).toString("utf8")));
      for (const hung of hungResponses) {
        hung.writeHead(500);
        hung.end("cancelled");
      }
      hungResponses.clear();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "PUT" && pathname === "/s3/upload") {
      const query = new URLSearchParams((req.url ?? "").split("?")[1]);
      const token = query.get("tok") ?? "";
      const partNumber = Number(query.get("part")) || undefined;
      const body = await readBody(req);

      if (config.hangFirstPut && !hungFirstPut && records.aborts.length === 0) {
        hungFirstPut = true;
        await new Promise<void>((resolve) => {
          hungResponses.add(res);
          res.on("close", resolve);
        });
        return;
      }

      if (shouldFailPut(partNumber)) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("internal error");
        return;
      }

      records.puts.push({
        uploadId: query.get("uploadId") || undefined,
        partNumber,
        token,
        body,
      });
      // Header name case alternates to exercise case-insensitive ETag reading.
      res.writeHead(200, tokenSeq % 2 ? { etag: `"etag-${token}"` } : { ETag: `"etag-${token}"` });
      res.end();
      return;
    }

    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        records,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections?.();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runUpload(
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("python3", [SCRIPT_PATH, ...args], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...envOverrides },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

const waitFor = async (predicate: () => boolean, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe.skipIf(!hasPython)("file-server-upload.py (end to end)", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "file-server-upload-"));
  const cleanupTmp = () => rmSync(tmp, { recursive: true, force: true });
  process.on("exit", cleanupTmp);

  it("uploads a small file via a single presigned PUT", async () => {
    const file = path.join(tmp, "hello.txt");
    writeFileSync(file, "hello world\n");
    const fake = await startFakeServer({ multipartThreshold: 1024, partSize: 512 });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file, "--prefix", "docs"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Done");
      expect(fake.records.creates[0]).toMatchObject({
        prefix: "docs",
        name: "hello.txt",
        size: 12,
        overwrite: false,
      });
      expect(fake.records.puts).toHaveLength(1);
      expect(fake.records.puts[0].body.toString()).toBe("hello world\n");
      expect(fake.records.completes).toHaveLength(0);
      expect(fake.records.aborts).toHaveLength(0);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("detects Content-Type via mimetypes with an octet-stream fallback", async () => {
    const txt = path.join(tmp, "notes.txt");
    const bin = path.join(tmp, "blob.unknownext");
    writeFileSync(txt, "x");
    writeFileSync(bin, "y");
    const fake = await startFakeServer({ multipartThreshold: 1024, partSize: 512 });
    try {
      await runUpload(["--server", fake.url, "--file", txt]);
      await runUpload(["--server", fake.url, "--file", bin]);
      const byName = (n: string) => fake.records.creates.filter((c) => c.name === n)[0];
      expect(byName("notes.txt").contentType).toContain("text/plain");
      expect(byName("blob.unknownext").contentType).toBe("application/octet-stream");
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("uploads a zero-byte file successfully", async () => {
    const file = path.join(tmp, "empty.bin");
    writeFileSync(file, "");
    const fake = await startFakeServer({ multipartThreshold: 1024, partSize: 512 });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file]);
      expect(result.code).toBe(0);
      expect(fake.records.creates[0]).toMatchObject({ name: "empty.bin", size: 0 });
      expect(fake.records.puts).toHaveLength(1);
      expect(fake.records.puts[0].body.length).toBe(0);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("supports unicode names, spaces and '#' characters", async () => {
    const name = "Ubuntu Server (Final) #2 – نسخة نهاية.iso";
    const file = path.join(tmp, name);
    writeFileSync(file, "iso-bytes");
    const fake = await startFakeServer({ multipartThreshold: 1024, partSize: 512 });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file]);
      expect(result.code).toBe(0);
      expect(fake.records.creates[0]).toMatchObject({ name, prefix: "", size: 9 });
      expect(fake.records.puts[0].body.toString()).toBe("iso-bytes");
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("performs a multipart upload with ordered parts and unchanged ETags", async () => {
    const file = path.join(tmp, "big.bin");
    const content = Buffer.from(Array.from({ length: 37 }, (_, i) => i + 1)); // 37 bytes -> 5x8B parts
    writeFileSync(file, content);
    const fake = await startFakeServer({ multipartThreshold: 16, partSize: 8 });
    try {
      const result = await runUpload([
        "--server", fake.url,
        "--file", file,
        "--concurrency", "2",
      ]);
      expect(result.code).toBe(0);

      const expectedParts = Math.ceil(37 / 8);
      expect(expectedParts).toBe(5);

      // Parts reassemble byte-exactly into the original content.
      const byPart = new Map<number, Buffer>();
      for (const put of fake.records.puts) byPart.set(put.partNumber!, put.body);
      expect(byPart.size).toBe(expectedParts);
      const reassembled = Buffer.concat(
        Array.from({ length: expectedParts }, (_, i) => byPart.get(i + 1)!),
      );
      expect(reassembled.equals(content)).toBe(true);

      // Complete receives every part in ascending order; ETags are passed
      // through unchanged from the PUT responses (quotes included).
      expect(fake.records.completes).toHaveLength(1);
      const completion = fake.records.completes[0] as {
        key: string;
        uploadId: string;
        parts: { partNumber: number; etag: string }[];
      };
      expect(completion.key).toBe("big.bin");
      expect(completion.parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5]);
      const tokenByPart = new Map(fake.records.puts.map((p) => [p.partNumber!, p.token]));
      for (const part of completion.parts) {
        expect(part.etag).toBe(`"etag-${tokenByPart.get(part.partNumber)}"`);
      }
      expect(fake.records.aborts).toHaveLength(0);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("retries a failed part using a freshly presigned URL", async () => {
    const file = path.join(tmp, "retry.bin");
    writeFileSync(file, Buffer.alloc(32, 7)); // 4 parts of 8 bytes
    const fake = await startFakeServer({
      multipartThreshold: 16,
      partSize: 8,
      failPartAttempts: { partNumber: 3, attempts: 2 },
    });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file]);
      expect(result.code).toBe(0);
      // Part 3 needed re-signing through the dedicated endpoint.
      expect(fake.records.presigns.length).toBeGreaterThanOrEqual(1);
      expect(fake.records.presigns.some((p) => (p.partNumbers as number[]).includes(3))).toBe(true);
      // Exactly one successful PUT for part 3 reached storage.
      expect(fake.records.puts.filter((p) => p.partNumber === 3)).toHaveLength(1);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("aborts the session and exits non-zero when a part fails permanently", async () => {
    const file = path.join(tmp, "doomed.bin");
    writeFileSync(file, Buffer.alloc(32, 1));
    const fake = await startFakeServer({
      multipartThreshold: 16,
      partSize: 8,
      failPartsAlways: [2],
    });
    try {
      const result = await runUpload([
        "--server", fake.url,
        "--file", file,
        "--concurrency", "1",
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("part 2/4 failed after 3 attempts");
      expect(fake.records.presigns.length).toBeGreaterThanOrEqual(1);
      expect(fake.records.completes).toHaveLength(0);
      expect(fake.records.aborts).toHaveLength(1);
      expect(String(fake.records.aborts[0].uploadId)).toMatch(/^mpu-/);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("returns API conflict errors clearly without --overwrite", async () => {
    const file = path.join(tmp, "report.pdf");
    writeFileSync(file, "pdf");
    const fake = await startFakeServer({
      multipartThreshold: 1024,
      partSize: 512,
      conflictNames: ["report.pdf"],
    });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("already exists");
      expect(fake.records.puts).toHaveLength(0);
      expect(fake.records.completes).toHaveLength(0);
      expect(fake.records.aborts).toHaveLength(0);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("passes --overwrite through to the API", async () => {
    const file = path.join(tmp, "report.pdf");
    writeFileSync(file, "pdf-v2");
    const fake = await startFakeServer({
      multipartThreshold: 1024,
      partSize: 512,
      conflictNames: ["report.pdf"],
    });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file, "--overwrite"]);
      expect(result.code).toBe(0);
      expect(fake.records.creates[0].overwrite).toBe(true);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("reads the server URL from FILE_SERVER_URL", async () => {
    const file = path.join(tmp, "env.bin");
    writeFileSync(file, "env");
    const fake = await startFakeServer({ multipartThreshold: 1024, partSize: 512 });
    try {
      const result = await runUpload(["--file", file], { FILE_SERVER_URL: fake.url });
      expect(result.code).toBe(0);
      expect(fake.records.creates).toHaveLength(1);
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("fails fast without any server URL", async () => {
    const file = path.join(tmp, "x.txt");
    writeFileSync(file, "x");
    const result = await runUpload(["--file", file], { FILE_SERVER_URL: undefined });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--server");
  }, 60_000);

  it("never leaks presigned URLs or signatures in its output", async () => {
    const file = path.join(tmp, "leak-check.txt");
    writeFileSync(file, "secret-ish");
    const fake = await startFakeServer({
      multipartThreshold: 1024,
      partSize: 512,
      conflictNames: ["leak-check.txt"],
    });
    try {
      const result = await runUpload(["--server", fake.url, "--file", file]);
      expect(result.code).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("X-Amz-Signature");
      expect(output).not.toContain("/s3/upload?");
    } finally {
      await fake.close();
    }
  }, 60_000);

  it("aborts the multipart session on SIGTERM and exits non-zero", async () => {
    const file = path.join(tmp, "interrupted.bin");
    writeFileSync(file, Buffer.alloc(32, 5));
    const fake = await startFakeServer({
      multipartThreshold: 16,
      partSize: 8,
      hangFirstPut: true,
    });
    try {
      const child: ChildProcess = spawn("python3", [SCRIPT_PATH, "--server", fake.url, "--file", file], {
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));

      // Wait until a part transfer is actually in flight, then interrupt.
      await waitFor(() => fake.records.creates.length === 1 && fake.records.puts.length >= 1);
      child.kill("SIGTERM");

      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(-99);
        }, 20_000);
        child.on("exit", (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });

      expect(code).not.toBe(0);
      expect(code).not.toBe(-99); // did not need SIGKILL
      expect(fake.records.aborts).toHaveLength(1);
      expect(fake.records.aborts[0].uploadId).toBeTruthy();
      expect(fake.records.completes).toHaveLength(0);
    } finally {
      await fake.close();
    }
  }, 60_000);
});
