# Internal File Server

A web-based file repository for internal networks, backed by an **S3-compatible Ceph Object Gateway (Ceph RGW)**. Browse, upload, download, rename and delete files through a clean file-manager UI — including multi-gigabyte ISO images.

Version 1 intentionally ships **without authentication**: it is designed to run inside a small trusted internal network. There is no database; S3 is the single source of truth.

## Features

- Folder browsing with breadcrumbs (`Home / ISO / Linux`)
- Upload single or multiple files via drag-and-drop or the Upload button
- **CLI Upload from Linux servers** — copy-paste `curl` or a Python 3 script straight from the UI (see [CLI Upload](#cli-upload-from-linux-servers))
- **Direct browser → Ceph multipart uploads** with progress, retry and cancel (files up to ~10 GB and beyond)
- Direct, stable HTTP download URLs that work with `wget`, `curl`, BMC/iLO remote-mount tools
- Full **HTTP Range** (`206 Partial Content`) and **HEAD** support on downloads
- Create / rename / delete files and folders (recursive delete with explicit confirmation)
- Client-side search filter, sorting by name/size/date, manual refresh
- **Global search across all folders** with a debounced results dropdown (server-backed, capped)
- Human-readable sizes, modification dates, empty/loading/error states
- Health endpoints suitable for Kubernetes probes

## Architecture

```
Upload (large files):
  Browser ── presigned part URLs ──────────────► Ceph RGW
     │                                              ▲
     │ create/complete/abort (JSON only)            │
     └──────────► Next.js API ──────────────────────┘

Download:
  Client ── GET /files/<key> (Range supported) ──► Next.js ── GetObject stream ──► Ceph RGW
```

- File data **never** flows through the Next.js server on upload: the browser uploads parts directly to Ceph using presigned URLs (64 MiB parts by default, automatically sized so the 10,000-part S3 limit is never hit).
- Downloads stream from Ceph through Next.js; `Range` headers are forwarded to S3 so only requested bytes travel. A 10 GB ISO can be served with constant memory.
- Folders are emulated with `/`-prefixed keys plus a zero-byte placeholder object ending in `/` (hidden in the UI).
- Rename = server-side copy + delete. Objects larger than 512 MiB are copied via multipart copy (`UploadPartCopy`) to respect the 5 GiB single-copy limit shared by AWS S3 and Ceph RGW.

## Requirements

- Node.js 20+ (development) or Docker
- A Ceph RGW (or any S3-compatible) endpoint with a bucket and access keys

## Development

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev                  # http://localhost:3000
```

Useful scripts:

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # vitest unit/integration tests
npm run build       # production build
```

The test suite includes an end-to-end harness for `public/file-server-upload.py` (it spawns the real script against a fake server). Those tests are skipped automatically on machines without `python3`.

### Developing without a real Ceph cluster

A tiny in-memory S3-compatible server is included for local testing:

```bash
node scripts/mock-s3.mjs          # listens on :9000, bucket "files"
S3_ENDPOINT=http://127.0.0.1:9000 \
S3_ACCESS_KEY=test S3_SECRET_KEY=test S3_BUCKET=files \
APP_BASE_URL=http://localhost:3000 npm run dev
```

It implements just enough of the S3 REST API (list/get/put/delete/multipart/copy) to exercise every feature end-to-end. It is a development aid only — never use it in production.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `S3_ENDPOINT` | yes | — | RGW/S3 endpoint, e.g. `https://s3.internal.example.com`. Must be reachable from **browsers**, since presigned upload URLs point here. |
| `S3_REGION` | no | `us-east-1` | Region string. Any value accepted by your RGW (`default` is common). |
| `S3_ACCESS_KEY` | yes | — | S3 access key (server-side only, never sent to the browser). |
| `S3_SECRET_KEY` | yes | — | S3 secret key (server-side only). |
| `S3_BUCKET` | yes | — | Bucket name. |
| `S3_FORCE_PATH_STYLE` | no | `true` | Keep `true` for Ceph RGW (bucket in path, not hostname). |
| `APP_BASE_URL` | recommended | request host | Public base URL used to build direct download links (`https://files.internal.example.com`). Set this behind ingress/proxies. |
| `UPLOAD_PART_SIZE_MB` | no | `64` | Multipart part size in MiB (8–5120). |
| `PRESIGN_EXPIRY_SECONDS` | no | `86400` | Presigned URL lifetime (60–604800). |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error`. |

Credentials are read only at runtime; building the image requires no secrets.

## Docker

```bash
docker build -t file-server .

docker run -d --name file-server -p 3000:3000 \
  -e S3_ENDPOINT=https://s3.internal.example.com \
  -e S3_REGION=default \
  -e S3_ACCESS_KEY=... \
  -e S3_SECRET_KEY=... \
  -e S3_BUCKET=files \
  -e S3_FORCE_PATH_STYLE=true \
  -e APP_BASE_URL=https://files.internal.example.com \
  file-server
```

The image is a multi-stage build running as non-root (`next start` standalone output).

### Docker Compose

```bash
cp .env.example .env    # fill in real values
docker compose up -d
```

## Kubernetes

Manifests live in [`k8s/`](k8s/):

```bash
kubectl apply -f k8s/deployment.yaml        # namespace, configmap, deployment, service, ingress

# Create the secret imperatively (do not commit real credentials):
kubectl -n file-server create secret generic file-server-s3 \
  --from-literal=S3_ACCESS_KEY='...' \
  --from-literal=S3_SECRET_KEY='...'
```

- `Deployment`: stateless, 2 replicas, non-root `securityContext`, resource limits.
- `livenessProbe`: `GET /api/health` — app process only, never touches S3 (a storage outage won't cause restart loops).
- `readinessProbe`: `GET /api/health/ready` — performs a HeadBucket against RGW; pod is removed from endpoints while storage is unavailable.
- `Service` + example nginx `Ingress` with buffering disabled for large streaming downloads.

No PVCs are needed — all data lives in S3, so replicas scale horizontally.

### Helm

The same deployment is packaged as a Helm chart in [`helm/file-server/`](helm/file-server/) (see its README for the full values reference):

```bash
kubectl -n file-server create secret generic file-server-s3 \
  --from-literal=S3_ACCESS_KEY='...' \
  --from-literal=S3_SECRET_KEY='...'

helm upgrade --install file-server helm/file-server \
  --namespace file-server --create-namespace \
  --set image.repository=registry.internal.example.com/file-server \
  --set config.s3Endpoint=https://s3.internal.example.com \
  --set s3.existingSecret=file-server-s3
```

The raw manifests in `k8s/` and the chart are kept equivalent; prefer one or the other per cluster to avoid drift.

## Ceph RGW configuration notes

1. **Path-style addressing**: the app defaults to `S3_FORCE_PATH_STYLE=true`, which virtually all RGW deployments require.
2. **Region string**: RGW accepts any region in the SigV4 scope; `default` or `us-east-1` are typical.
3. **CORS is required for uploads.** Browsers upload parts directly to RGW, so the bucket must allow the app's origin and expose `ETag`:

   ```xml
   <CORSConfiguration>
     <CORSRule>
       <AllowedOrigin>https://files.internal.example.com</AllowedOrigin>
       <AllowedMethod>PUT</AllowedMethod>
       <AllowedMethod>GET</AllowedMethod>
       <AllowedMethod>HEAD</AllowedMethod>
       <AllowedHeader>*</AllowedHeader>
       <ExposeHeader>ETag</ExposeHeader>
       <MaxAgeSeconds>3000</MaxAgeSeconds>
     </CORSRule>
   </CORSConfiguration>
   ```

   Apply with `s3cmd setcors cors.xml s3://files` or `radosgw-admin` equivalents. Without `<ExposeHeader>ETag</ExposeHeader>` the browser cannot read part ETags and multipart completion will fail.
4. **Reachability**: `S3_ENDPOINT` must resolve from user machines (not just the cluster), because uploads go browser → RGW directly.
5. Checksums: the app configures AWS SDK v3 with `WHEN_REQUIRED` checksum behavior for compatibility with older RGW versions.

## Testing direct downloads

```bash
# Metadata (HEAD must not transfer the body)
curl -I https://files.example.com/files/iso/ubuntu.iso

# Full download
wget https://files.example.com/files/iso/ubuntu.iso

# Range request — must return HTTP 206 Partial Content
curl \
  -H "Range: bytes=0-1048575" \
  -o first-megabyte.bin \
  https://files.example.com/files/iso/ubuntu.iso

# Verify only 1 MiB was transferred
ls -lh first-megabyte.bin
```

A successful range response includes:

```
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/<total-size>
Content-Length: 1048576
```

Multi-range requests are answered with the full object (200), matching common server behavior.

## CLI Upload (from Linux servers)

The **CLI Upload** button in the toolbar opens a dialog with two ready-to-run recipes for uploading files from any Linux server: a **Python** tab and a **curl** tab. Both target the folder you currently have open and never contain credentials — presigned URLs are minted at run time.

### Prerequisites

- The Linux server must be able to reach the File Server application *and* the Ceph/S3 endpoint (`S3_ENDPOINT`) directly over the network, because file bytes are transferred straight to storage using short-lived presigned URLs.
- Python 3 (any modern 3.x) for the script variant — **standard library only**, nothing to `pip install`.
- `curl` plus [`jq`](https://jqlang.github.io/jq/) for the curl variant.
- The application currently has **no authentication**: anyone who can reach it can upload. Keep it on a trusted internal network.

### Downloading the upload script

Click **Download script** in the dialog's Python tab, or fetch the stable URL directly:

```bash
wget https://files.example.com/file-server-upload.py
```

The served copy is the same file that lives at `public/file-server-upload.py` in the repository — there is only one source of truth.

### Python examples

```bash
# Bucket root
python3 file-server-upload.py \
    --server https://files.example.com \
    --file ./ubuntu.iso

# Into the iso/linux prefix
python3 file-server-upload.py \
    --server https://files.example.com \
    --file ./ubuntu.iso \
    --prefix iso/linux

# Replace an existing file
python3 file-server-upload.py \
    --server https://files.example.com \
    --file ./ubuntu.iso \
    --prefix iso/linux \
    --overwrite

# Server URL via environment variable instead of --server
FILE_SERVER_URL=https://files.example.com python3 file-server-upload.py --file big.iso

# Tune parallel part uploads (default 3)
python3 file-server-upload.py --server https://files.example.com --file big.iso --concurrency 4

# Upload a directory recursively. The directory itself becomes a folder in the destination.
python3 file-server-upload.py --server https://files.example.com --directory ./release --prefix artifacts
```

Behaviour summary:

| Option | Meaning |
|---|---|
| `--server URL` | File Server base URL (falls back to `FILE_SERVER_URL`) |
| `--file PATH` | Local file; its basename becomes the destination name |
| `--directory PATH` | Recursively upload a directory; its basename and layout are preserved, including empty folders |
| `--prefix PREFIX` | Destination folder (default: bucket root) |
| `--overwrite` | Replace an existing destination file |
| `--concurrency N` | Parallel part uploads for large files (default `3`) |

Small files are uploaded with one presigned PUT. Larger files use multipart upload with concurrent parts, per-part retries (three attempts, exponential backoff, fresh presigned URLs when needed), live progress, and automatic abort cleanup on failure or Ctrl+C/SIGTERM. Directory uploads preserve the source directory as the first destination segment and deliberately reject symlinks. Exit code is `0` on success.

Directory upload uses a versioned CLI capability, separate from the web-app release version. A mismatched CLI/server protocol fails before any object is written and prints the URL for downloading the matching script. File-only uploads remain compatible with older servers.

Run `python3 file-server-upload.py --version` to display the uploader's protocol version.

### curl example (small files only)

The dialog's curl tab copies a self-contained bash snippet that calls `POST /api/uploads/create`, checks the response mode, and uploads with `curl --upload-file`. Edit the `FILE`, `SERVER`, `PREFIX` and `CONTENT_TYPE` variables at the top.

**Limitation:** it supports only files for which the API returns `mode: "single"` — with the default configuration that is up to and including **32 MiB**. If the server answers `mode: "multipart"`, the snippet stops with an error and points you to the Python script.

```bash
#!/usr/bin/env bash
# Dependency: jq must be installed (used to parse the JSON response).
set -euo pipefail

FILE=./release.tar.gz                   # local file to upload
SERVER=https://files.example.com        # File Server base URL
PREFIX=''                               # destination prefix ('' = bucket root)
CONTENT_TYPE=application/octet-stream

NAME="$(basename "$FILE")"
SIZE=$(stat -c%s "$FILE")               # GNU stat (Linux)

RESPONSE=$(curl -fsS -X POST "$SERVER/api/uploads/create" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg p "$PREFIX" --arg n "$NAME" --argjson s "$SIZE" \
        '{prefix: $p, name: $n, size: $s, contentType: $CONTENT_TYPE}')")

MODE=$(jq -r '.mode' <<<"$RESPONSE")
if [ "$MODE" != "single" ]; then
  echo "Server returned mode '$MODE'; curl supports mode 'single' only" >&2
  echo "(files up to and including 32 MiB)." >&2
  echo "Use the Python script for larger files:" >&2
  echo "  python3 file-server-upload.py --server $SERVER --file $FILE --prefix $PREFIX" >&2
  exit 1
fi

URL=$(jq -r '.url' <<<"$RESPONSE")      # presigned URL — treat as a secret
curl -fsS -X PUT --upload-file "$FILE" -H "Content-Type: $CONTENT_TYPE" "$URL"

echo "Uploaded to ${PREFIX:+$PREFIX/}$NAME"
```

Presigned URLs embed temporary credentials: keep them out of logs and shell history.

## API overview

| Method & path | Purpose |
|---|---|
| `GET /api/files?prefix=…` | List one folder level (folders first, full pagination) |
| `GET /api/search?q=…&prefix=…` | Recursive case-insensitive name search under a prefix (capped at 200 hits) |
| `DELETE /api/files` | Delete `{key, type: "file"\|"folder"}` (folder = recursive) |
| `POST /api/files/rename` | Rename `{from, to, isFolder, overwrite?}` (copy + delete) |
| `POST /api/folders` | Create folder `{prefix, name}` |
| `POST /api/uploads/create` | Prepare upload → single presigned PUT or multipart plan |
| `POST /api/uploads/presign-part` | Re-sign parts (retry/expiry path) |
| `POST /api/uploads/complete` | CompleteMultipartUpload with collected ETags |
| `POST /api/uploads/abort` | AbortMultipartUpload (cancel/cleanup) |
| `GET /api/cli/capabilities` | Versioned capabilities used by optional CLI features |
| `GET /files/[...path]` | Stream download (Range → 206) |
| `HEAD /files/[...path]` | Metadata only (Range-aware) |
| `GET /api/health` | Liveness: `{"status":"ok"}` |
| `GET /api/health/ready` | Readiness incl. storage check |

Errors return JSON `{ "error": "…" }` with safe messages; details and credentials never reach the client.

## Security baseline (v1)

- All key/prefix inputs are validated: traversal (`..`), control characters, absolute paths and oversized keys are rejected; input is never double-decoded, so names like `Ubuntu Server (Final) #2.iso` or `نسخه-نهایی.iso` work correctly.
- S3 credentials stay server-side; only short-lived presigned upload URLs are exposed to browsers.
- Destructive operations require explicit UI confirmation; deleting the bucket root is impossible.
- Filenames are rendered as text (React escaping); downloads send RFC 5987 `Content-Disposition`.

## Project structure

```
src/
  app/
    api/               # JSON API routes (files, folders, uploads, health)
    files/[...path]/   # Streaming download endpoint (GET/HEAD)
    page.tsx           # File manager UI entry
  components/          # UI components (table, toolbar, dialogs, upload panel)
  hooks/               # useFileListing, useUploads
  lib/
    api/               # Response/error helpers
    cli/               # CLI Upload command generation (+ Python script harness)
    http/              # Key<->URL encoding, Range parsing, base URL
    s3/                # S3 client factory (RGW-compatible settings)
    storage/           # StorageService interface + S3 implementation
    uploads/           # Multipart math (part sizing)
    validation/        # Key/name validation
  types/
public/
  file-server-upload.py  # Standalone CLI uploader (served at /file-server-upload.py)
scripts/mock-s3.mjs     # Dev-only S3 simulator
k8s/                    # Kubernetes manifests
helm/file-server/       # Helm chart (equivalent to the k8s/ manifests)
```

The storage layer sits behind a small `StorageService` interface (`src/lib/storage/types.ts`), so future backends (local disk, NFS) can be added without touching UI or API code.
