#!/usr/bin/env python3
"""
file-server-upload.py — upload a file to the Internal File Server from any
machine with Python 3. Uses only the standard library; nothing to pip install.

The File Server application only orchestrates uploads: the file bytes go
straight from this machine to the Ceph/S3 storage endpoint using short-lived
presigned URLs. The Linux server must therefore be able to reach that S3
endpoint directly over HTTPS/HTTP.

Usage:
    python3 file-server-upload.py \
        --server https://files.example.com \
        --file ./ubuntu.iso \
        --prefix iso/linux

    # server URL via environment variable instead of --server
    FILE_SERVER_URL=https://files.example.com python3 file-server-upload.py --file big.iso

Options:
    --server URL       File Server base URL (or FILE_SERVER_URL env var)
    --file PATH        Local file to upload
    --prefix PREFIX    Destination folder inside the bucket (default: bucket root)
    --overwrite        Replace the destination file if it already exists
    --concurrency N    Parallel part uploads for large files (default: 3)

Behaviour:
    * Small files (the server decides, currently <= 32 MiB) are uploaded with
      a single presigned PUT request.
    * Larger files use an S3 multipart upload: parts are uploaded concurrently,
      each retried up to three times with exponential backoff. A failed or
      expired presigned URL is refreshed through the File Server before the
      next attempt.
    * On failure, Ctrl+C or SIGTERM an active multipart upload is aborted so
      no orphaned parts remain in storage.
    * No AWS/S3 credentials are required — only the presigned URLs issued by
      the File Server. Those URLs embed temporary credentials, so they are
      never printed.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DEFAULT_CONCURRENCY = 3
PART_ATTEMPTS = 3
RETRY_BASE_DELAY = 0.5  # seconds, doubled on every retry (exponential backoff)
API_TIMEOUT = 60  # seconds for JSON API calls
PRESIGN_BATCH = 250  # presign-part calls stay reasonably sized

EXIT_OK = 0
EXIT_FAILED = 1


class UploadError(Exception):
    """Fatal upload error carrying a user-facing message."""


class ApiClient:
    """JSON client for the File Server API (metadata only, never file bytes)."""

    def __init__(self, server: str):
        self.server = server.rstrip("/")

    def post(self, path: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.server}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=API_TIMEOUT) as response:
                body = response.read()
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8")).get("error", "")
            except Exception:
                detail = ""
            message = f"{path} failed with HTTP {err.code}"
            if detail:
                message += f": {detail}"
            raise UploadError(message) from err
        except (urllib.error.URLError, OSError) as err:
            reason = getattr(err, "reason", err)
            raise UploadError(
                f"Could not reach the File Server at {self.server} ({describe(err)})"
            ) from err
        return json.loads(body.decode("utf-8"))

    def create_upload(self, prefix: str, name: str, size: int,
                      content_type: str, overwrite: bool) -> dict:
        return self.post(
            "/api/uploads/create",
            {
                "prefix": prefix,
                "name": name,
                "size": size,
                "contentType": content_type,
                "overwrite": overwrite,
            },
        )

    def presign_parts(self, key: str, upload_id: str, part_numbers: list) -> dict:
        return self.post(
            "/api/uploads/presign-part",
            {"key": key, "uploadId": upload_id, "partNumbers": part_numbers},
        )

    def complete(self, key: str, upload_id: str, parts: list) -> dict:
        return self.post(
            "/api/uploads/complete",
            {"key": key, "uploadId": upload_id, "parts": parts},
        )

    def abort(self, key: str, upload_id: str) -> None:
        # Best effort: cleanup must never mask the original error.
        try:
            self.post("/api/uploads/abort", {"key": key, "uploadId": upload_id})
        except Exception:
            pass


def describe(err: BaseException) -> str:
    """Short human-readable description of a network/HTTP error."""
    if isinstance(err, urllib.error.HTTPError):
        return f"HTTP {err.code}"
    if isinstance(err, urllib.error.URLError):
        return describe(getattr(err, "reason", err))
    if isinstance(err, (socket.timeout, TimeoutError)):
        return "connection timed out"
    text = str(err)
    return text if text else type(err).__name__


def format_bytes(num: float) -> str:
    value = float(num)
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    index = 0
    while value >= 1024 and index < len(units) - 1:
        value /= 1024
        index += 1
    return f"{int(value)} B" if index == 0 else f"{value:.1f} {units[index]}"


class Progress:
    """Aggregate progress printer (percentage, uploaded bytes, total bytes)."""

    def __init__(self, total_bytes: int):
        self.total = total_bytes
        self.done = 0
        self.line_len = 0
        self.lock = threading.Lock()

    def advance(self, delta: int) -> None:
        with self.lock:
            self.done += delta
            done = min(self.done, self.total)
        self.render(done)

    def render(self, done: int) -> None:
        if not sys.stderr.isatty():
            return
        percent = (done / self.total * 100) if self.total > 0 else 100.0
        line = f"\r{percent:6.2f}%  {format_bytes(done)} / {format_bytes(self.total)}"
        padding = max(0, self.line_len - len(line))
        sys.stderr.write(line + (" " * padding))
        sys.stderr.flush()
        self.line_len = len(line)

    def clear(self) -> None:
        if not sys.stderr.isatty():
            return
        sys.stderr.write("\r" + (" " * self.line_len) + "\r")
        sys.stderr.flush()
        self.line_len = 0


def put_to_presigned_url(url: str, data: bytes, content_type: str,
                         require_etag: bool) -> str:
    """PUT `data` directly to a presigned Ceph/S3 URL. Returns the ETag.

    Presigned URLs carry temporary credentials in their query string, so the
    URL itself is never included in error messages — only status codes.
    """
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": content_type},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(request) as response:
            # HTTPMessage lookups are case-insensitive (RFC 9110 section 5.1).
            etag = response.headers.get("ETag", "").strip()
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as err:
        raise RuntimeError(describe(err)) from err
    if require_etag and not etag:
        # Retryable? A missing ETag makes multipart completion impossible.
        raise UploadError(
            "storage did not return an ETag header; cannot complete the "
            "multipart upload"
        )
    return etag


class MultipartUploader:
    """Concurrent part uploader with retries and fresh presigned URLs."""

    def __init__(self, api: ApiClient, path: str, key: str, upload_id: str,
                 part_size: int, total_size: int, concurrency: int,
                 progress: Progress):
        self.api = api
        self.path = path
        self.key = key
        self.upload_id = upload_id
        self.part_size = part_size
        self.total_size = total_size
        self.concurrency = max(1, concurrency)
        self.progress = progress
        self.etags: dict = {}
        self.stop = threading.Event()
        self.lock = threading.Lock()

    def part_count(self) -> int:
        return max(1, (self.total_size + self.part_size - 1) // self.part_size)

    def read_part(self, part_number: int) -> bytes:
        # Each call opens its own handle: worker threads must never share a
        # seek position.
        start = (part_number - 1) * self.part_size
        with open(self.path, "rb") as fileobj:
            fileobj.seek(start)
            end = min(start + self.part_size, self.total_size)
            return fileobj.read(end - start)

    def fresh_urls(self, part_numbers: list) -> dict:
        urls = {}
        for offset in range(0, len(part_numbers), PRESIGN_BATCH):
            batch = part_numbers[offset:offset + PRESIGN_BATCH]
            result = self.api.presign_parts(self.key, self.upload_id, batch)
            urls.update({p["partNumber"]: p["url"] for p in result["parts"]})
        return urls

    def upload_one(self, part_number: int, url: str, content_type: str) -> None:
        """Upload a single part, retrying with exponential backoff."""
        data = self.read_part(part_number)
        current_url = url
        last_error: BaseException | None = None
        for attempt in range(1, PART_ATTEMPTS + 1):
            if self.stop.is_set():
                raise UploadError("upload cancelled")
            try:
                etag = put_to_presigned_url(current_url, data, content_type, True)
                with self.lock:
                    self.etags[part_number] = etag
                self.progress.advance(len(data))
                return
            except UploadError:
                raise  # permanent problem; retrying cannot help
            except RuntimeError as err:
                last_error = err
                if attempt >= PART_ATTEMPTS:
                    break
                if self.stop.is_set():
                    raise UploadError("upload cancelled")
                time.sleep(RETRY_BASE_DELAY * (2 ** (attempt - 1)))
                # Signature expired or transient failure: get a fresh presigned
                # URL before the next attempt.
                try:
                    current_url = self.fresh_urls([part_number])[part_number]
                except UploadError as api_err:
                    last_error = api_err
                    break
        raise UploadError(
            f"part {part_number}/{self.part_count()} failed after "
            f"{PART_ATTEMPTS} attempts: {describe(last_error)}"
        )

    def run(self, content_type: str, urls: dict) -> str | None:
        numbers = list(range(1, self.part_count() + 1))
        missing = [n for n in numbers if n not in urls]
        if missing:
            urls = {**urls, **self.fresh_urls(missing)}

        queue = list(numbers)
        queue_lock = threading.Lock()

        def worker() -> None:
            while not self.stop.is_set():
                with queue_lock:
                    if self.stop.is_set() or not queue:
                        return
                    part_number = queue.pop(0)
                try:
                    self.upload_one(part_number, urls[part_number], content_type)
                except Exception:
                    self.stop.set()  # fail fast: stop scheduling new work
                    raise

        pool = ThreadPoolExecutor(max_workers=min(self.concurrency, len(numbers)))
        futures = [pool.submit(worker) for _ in range(min(self.concurrency, len(numbers)))]
        try:
            for future in futures:
                future.result()
        except BaseException:
            self.stop.set()
            pool.shutdown(wait=False)
            raise
        pool.shutdown(wait=False)

        ordered = [{"partNumber": n, "etag": self.etags[n]} for n in sorted(self.etags)]
        if len(ordered) != len(numbers):
            raise UploadError("multipart upload finished with missing parts")

        self.progress.clear()
        result = self.api.complete(self.key, self.upload_id, ordered)
        return result.get("etag")


def install_signal_handlers() -> None:
    """Turn SIGINT/SIGTERM into exceptions so the abort-cleanup path runs."""

    def terminate(signum, _frame):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGINT, terminate)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, terminate)


def normalize_prefix(prefix: str) -> str:
    segments = [segment for segment in prefix.split("/") if segment]
    return "/".join(segments)


def guess_content_type(path: str) -> str:
    guessed, _encoding = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def parse_args(argv: list | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Upload a file to the Internal File Server (direct-to-storage).",
    )
    parser.add_argument(
        "--server",
        default=os.environ.get("FILE_SERVER_URL", ""),
        help="File Server base URL (or set the FILE_SERVER_URL environment variable)",
    )
    parser.add_argument("--file", required=True, help="local file to upload")
    parser.add_argument(
        "--prefix",
        default="",
        help='destination folder inside the bucket (default: bucket root)',
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace the destination file if it already exists",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        metavar="N",
        help=f"parallel part uploads for large files (default {DEFAULT_CONCURRENCY})",
    )
    args = parser.parse_args(argv)
    if not args.server:
        parser.error(
            "--server is required (or set the FILE_SERVER_URL environment variable)"
        )
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    return args


def main(argv: list | None = None) -> int:
    args = parse_args(argv)

    path = os.path.expanduser(args.file)
    try:
        size = os.path.getsize(path)
    except OSError as err:
        print(f"error: cannot read '{args.file}': {err.strerror}", file=sys.stderr)
        return EXIT_FAILED

    name = os.path.basename(path)
    prefix = normalize_prefix(args.prefix)
    content_type = guess_content_type(name)
    destination = f"{prefix}/{name}" if prefix else name

    print(f"Uploading '{name}' ({format_bytes(size)}) to '{destination}'")

    api = ApiClient(args.server)
    key = None
    upload_id = None
    install_signal_handlers()
    try:
        plan = api.create_upload(prefix, name, size, content_type, args.overwrite)
        key = plan["key"]
        progress = Progress(size)

        if plan["mode"] == "single":
            with open(path, "rb") as fileobj:
                put_to_presigned_url(plan["url"], fileobj.read(), content_type, False)
            progress.clear()
            print(f"Done — uploaded to '{plan['key']}' (single PUT)")
            return EXIT_OK

        if plan["mode"] == "multipart":
            upload_id = plan["uploadId"]
            uploader = MultipartUploader(
                api,
                path,
                key,
                upload_id,
                plan["partSize"],
                size,
                args.concurrency,
                progress,
            )
            initial_urls = {p["partNumber"]: p["url"] for p in plan["parts"]}
            uploader.run(content_type, initial_urls)
            upload_id = None  # finalized; nothing left to clean up
            print(f"Done — uploaded to '{plan['key']}' "
                  f"(multipart, {uploader.part_count()} parts)")
            return EXIT_OK

        raise UploadError(f"server returned unknown upload mode '{plan['mode']}'")
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted — cancelling the upload…\n")
        return EXIT_FAILED
    except UploadError as err:
        print(f"\nerror: {err}", file=sys.stderr)
        return EXIT_FAILED
    finally:
        if upload_id and key:
            api.abort(key, upload_id)


if __name__ == "__main__":
    sys.exit(main())
