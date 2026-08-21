/**
 * Minimal in-memory S3-compatible server for LOCAL development/testing only.
 * Implements just enough of the S3 REST API (path-style) to exercise the
 * file server end-to-end without a real Ceph RGW:
 *
 *   node scripts/mock-s3.mjs            # listens on :9000, bucket "files"
 *
 * NOT for production use. Ignores authentication entirely.
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_S3_PORT ?? 9000);
const BUCKET = process.env.MOCK_S3_BUCKET ?? "files";

/** key -> { data: Buffer, contentType, etag, lastModified } */
const objects = new Map();
/** uploadId -> { key, contentType, parts: Map<number, Buffer> } */
const uploads = new Map();

const xml = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${body.trimStart()}`;

function send(res, status, headers = {}, body = null) {
  res.writeHead(status, headers);
  res.end(body);
  return;
}

function objectHeaders(obj) {
  return {
    "Content-Type": obj.contentType,
    "Content-Length": String(obj.data.length),
    ETag: obj.etag,
    "Last-Modified": obj.lastModified.toUTCString(),
    "Accept-Ranges": "bytes",
  };
}

const server = http.createServer((req, res) => {
  if (process.env.MOCK_S3_VERBOSE) console.log("[mock-s3]", req.method, req.url);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const q = url.searchParams;

  // CORS so browsers can PUT directly (mirrors required RGW configuration).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Range, Content-Length");
  if (req.method === "OPTIONS") {
    return send(res, 204);
  }

  const parts = url.pathname.replace(/^\/+/, "").split("/");
  const bucket = parts[0];
  const keyParts = parts.slice(1);
  const hasKey = keyParts.some((s) => s.length > 0);
  const key = keyParts.map((s) => decodeURIComponent(s)).join("/");

  // ---------- HeadBucket ----------
  if (bucket === BUCKET && !hasKey && req.method === "HEAD") {
    return send(res, 200, { "Content-Length": "0" });
  }
  if (bucket !== BUCKET) {
    return send(res, 404, { "Content-Type": "application/xml" }, xml(`<Error><Code>NoSuchBucket</Code></Error>`));
  }

  // ---------- ListObjectsV2 ----------
  if (!hasKey && req.method === "GET" && q.get("list-type") === "2") {
    const prefix = q.get("prefix") ?? "";
    const delimiter = q.get("delimiter") ?? "";
    const all = [...objects.keys()].sort();

    const contents = [];
    const prefixes = new Set();
    for (const k of all) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (delimiter && rest.includes(delimiter)) {
        prefixes.add(prefix + rest.split(delimiter)[0] + delimiter);
      } else {
        contents.push(k);
      }
    }

    const contentsXml = contents
      .map((k) => {
        const o = objects.get(k);
        return `<Contents><Key>${escapeXml(k)}</Key><Size>${o.data.length}</Size><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>&quot;${o.etag.replace(/"/g, "")}&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join("");
    const prefixesXml = [...prefixes]
      .map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`)
      .join("");

    return send(
      res,
      200,
      { "Content-Type": "application/xml" },
      xml(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${BUCKET}</Name><Prefix>${escapeXml(prefix)}</Prefix><Delimiter>${delimiter}</Delimiter><IsTruncated>false</IsTruncated>${contentsXml}${prefixesXml}</ListBucketResult>`),
    );
  }

  // ---------- DeleteObjects (batch) ----------
  if (!hasKey && req.method === "POST" && q.has("delete")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      const keys = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) =>
        m[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&"),
      );
      for (const k of keys) objects.delete(k);
      const result = xml(
        `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys
          .map((k) => `<Deleted><Key>${escapeXml(k)}</Key></Deleted>`)
          .join("")}</DeleteResult>`,
      );
      return send(res, 200, { "Content-Type": "application/xml" }, result);
    });
    return;
  }

  // ---------- Multipart: initiate ----------
  if (hasKey && req.method === "POST" && q.has("uploads")) {
    const uploadId = crypto.randomUUID();
    uploads.set(uploadId, { key, contentType: req.headers["content-type"] ?? "", parts: new Map() });
    return send(
      res,
      200,
      { "Content-Type": "application/xml" },
      xml(`<InitiateMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`),
    );
  }

  // ---------- Multipart: complete ----------
  if (hasKey && req.method === "POST" && q.get("uploadId")) {
    const uploadId = q.get("uploadId");
    const session = uploads.get(uploadId);
    if (!session) {
      return send(res, 404, { "Content-Type": "application/xml" }, xml(`<Error><Code>NoSuchUpload</Code></Error>`));
    }
    const numbers = [...session.parts.keys()].sort((a, b) => a - b);
    const data = Buffer.concat(numbers.map((n) => session.parts.get(n)));
    const etag = `"${crypto.randomBytes(16).toString("hex")}"`;
    objects.set(session.key, {
      data,
      contentType: session.contentType || "application/octet-stream",
      etag,
      lastModified: new Date(),
    });
    uploads.delete(uploadId);
    return send(
      res,
      200,
      { "Content-Type": "application/xml" },
      xml(`<CompleteMultipartUploadResult><Location>http://127.0.0.1:${PORT}/${BUCKET}</Location><Bucket>${BUCKET}</Bucket><Key>${escapeXml(session.key)}</Key><ETag>&quot;${etag.replace(/"/g, "")}&quot;</ETag></CompleteMultipartUploadResult>`),
    );
  }

  // ---------- Multipart: abort ----------
  if (hasKey && req.method === "DELETE" && q.get("uploadId")) {
    uploads.delete(q.get("uploadId"));
    return send(res, 204);
  }

  // ---------- CopyObject ----------
  if (
    hasKey &&
    req.method === "PUT" &&
    (q.get("x-id") === "CopyObject" || req.headers["x-amz-copy-source"])
  ) {
    const rawSource = String(req.headers["x-amz-copy-source"] ?? "").replace(/^\/+/, "");
    const srcKey = rawSource
      .split("/")
      .slice(1)
      .map((s) => decodeURIComponent(s))
      .join("/");
    const source = objects.get(srcKey);
    if (!source) {
      return send(res, 404, { "Content-Type": "application/xml" }, xml(`<Error><Code>NoSuchKey</Code></Error>`));
    }
    const etag = `"${crypto.randomBytes(16).toString("hex")}"`;
    const lastModified = new Date();
    objects.set(key, { ...source, etag, lastModified });
    return send(
      res,
      200,
      { "Content-Type": "application/xml" },
      xml(`<CopyObjectResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ETag>&quot;${etag.replace(/"/g, "")}&quot;</ETag><LastModified>${lastModified.toISOString()}</LastModified></CopyObjectResult>`),
    );
  }

  // ---------- UploadPart ----------
  if (hasKey && req.method === "PUT" && q.get("partNumber") && q.get("uploadId")) {
    const session = uploads.get(q.get("uploadId"));
    if (!session) return send(res, 404, {}, xml(`<Error><Code>NoSuchUpload</Code></Error>`));
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const partNumber = Number(q.get("partNumber"));
      session.parts.set(partNumber, Buffer.concat(chunks));
      const etag = `"${crypto.randomBytes(16).toString("hex")}"`;
      return send(res, 200, { ETag: etag });
    });
    return;
  }

  // ---------- PutObject ----------
  if (hasKey && req.method === "PUT") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      objects.set(key, {
        data: Buffer.concat(chunks),
        contentType: req.headers["content-type"] || "application/octet-stream",
        etag: `"${crypto.randomBytes(16).toString("hex")}"`,
        lastModified: new Date(),
      });
      return send(res, 200, { ETag: objects.get(key).etag });
    });
    return;
  }

  // ---------- DeleteObject ----------
  if (hasKey && req.method === "DELETE") {
    objects.delete(key);
    return send(res, 204);
  }

  // ---------- HeadObject ----------
  if (hasKey && req.method === "HEAD") {
    const obj = objects.get(key);
    if (!obj) return send(res, 404);
    return send(res, 200, objectHeaders(obj));
  }

  // ---------- GetObject ----------
  if (hasKey && req.method === "GET") {
    const obj = objects.get(key);
    if (!obj) {
      return send(res, 404, { "Content-Type": "application/xml" }, xml(`<Error><Code>NoSuchKey</Code></Error>`));
    }

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start;
        let end;
        if (m[1] === "") {
          const n = Number(m[2]);
          start = Math.max(0, obj.data.length - n);
          end = obj.data.length - 1;
        } else {
          start = Number(m[1]);
          end = m[2] === "" ? obj.data.length - 1 : Math.min(Number(m[2]), obj.data.length - 1);
        }
        if (obj.data.length === 0 || start >= obj.data.length || start > end) {
          return send(res, 416, { "Content-Range": `bytes */${obj.data.length}` });
        }
        const slice = obj.data.subarray(start, end + 1);
        return send(res, 206, {
          ...objectHeaders(obj),
          "Content-Range": `bytes ${start}-${end}/${obj.data.length}`,
          "Content-Length": String(slice.length),
        }, slice);
      }
    }

    return send(res, 200, objectHeaders(obj), obj.data);
  }

  return send(res, 400, {}, "Unsupported");
});

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c],
  );
}

// Seed a couple of demo objects so the UI has something to show.
objects.set("seed/readme.txt", {
  data: Buffer.from("Internal file server — mock S3 seed object.\n"),
  contentType: "text/plain",
  etag: `"${crypto.randomBytes(16).toString("hex")}"`,
  lastModified: new Date(),
});
objects.set("seed/", {
  data: Buffer.alloc(0),
  contentType: "application/x-directory",
  etag: `"${crypto.randomBytes(16).toString("hex")}"`,
  lastModified: new Date(),
});

server.listen(PORT, () => {
  console.log(`mock S3 listening on http://127.0.0.1:${PORT} (bucket "${BUCKET}")`);
});
