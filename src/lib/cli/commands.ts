/**
 * CLI command generation for the "CLI Upload" dialog.
 *
 * Pure string building so the dialog stays presentational and the exact
 * commands users copy-paste can be tested without a DOM.
 */

/** Path of the downloadable upload script, served from public/. */
export const UPLOAD_SCRIPT_PATH = "/file-server-upload.py";

/** The API returns mode "single" only at or below this size (see parts.ts). */
export const SMALL_FILE_LIMIT_MIB = 32;

export interface CliCommandOptions {
  /** File Server base URL, e.g. "https://files.example.com". */
  serverUrl: string;
  /** Prefix currently open in the UI, with or without trailing slash. */
  prefix: string;
}

/**
 * Strip the trailing slash the UI uses for folder prefixes; "" means bucket
 * root. No further validation here — the server validates the prefix when
 * the command runs.
 */
export function cliPrefix(prefix: string): string {
  return prefix.replace(/\/+$/, "");
}

function shellQuote(value: string): string {
  // POSIX single-quote escaping; handles spaces and all other metacharacters.
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildPythonCommand({ serverUrl, prefix }: CliCommandOptions): string {
  const parts = ["python3 file-server-upload.py"];
  if (serverUrl) parts.push(`--server ${shellQuote(serverUrl)}`);
  parts.push("--file ./path/to/file.bin");
  const target = cliPrefix(prefix);
  if (target) parts.push(`--prefix ${shellQuote(target)}`);
  return parts.join(" \\\n    ");
}

const CURL_SCRIPT_TEMPLATE = `#!/usr/bin/env bash
# Upload one small file to the File Server using curl.
#
# Dependency: jq must be installed (used to parse the JSON response).
# Limitation: this example supports files for which the API returns
# mode "single" — with the default configuration that is up to and
# including SMALL_FILE_LIMIT MiB. Larger files report mode "multipart"
# and need the Python script instead.
set -euo pipefail

FILE=./path/to/file.bin                 # local file to upload
SERVER=SERVER_URL_PLACEHOLDER           # File Server base URL
PREFIX=PREFIX_PLACEHOLDER               # destination prefix ('' = bucket root)
CONTENT_TYPE=application/octet-stream   # Content-Type of the upload

NAME="\$(basename "\$FILE")"
SIZE=\$(stat -c%s "\$FILE")             # GNU stat (Linux)

RESPONSE=\$(curl -fsS -X POST "\$SERVER/api/uploads/create" \\
  -H 'Content-Type: application/json' \\
  -d "\$(jq -n --arg p "\$PREFIX" --arg n "\$NAME" --argjson s "\$SIZE" \\
        '{prefix: \$p, name: \$n, size: \$s, contentType: \$CONTENT_TYPE}')")

MODE=\$(jq -r '.mode' <<<"\$RESPONSE")
if [ "\$MODE" != "single" ]; then
  echo "Server returned mode '\$MODE'; curl supports mode 'single' only" >&2
  echo "(files up to and including SMALL_FILE_LIMIT MiB)." >&2
  echo "Use the Python script for larger files:" >&2
  echo "  python3 file-server-upload.py --server \$SERVER --file \$FILE --prefix \$PREFIX" >&2
  exit 1
fi

URL=\$(jq -r '.url' <<<"\$RESPONSE")     # presigned URL — treat as a secret
curl -fsS -X PUT --upload-file "\$FILE" -H "Content-Type: \$CONTENT_TYPE" "\$URL"

echo "Uploaded to \${PREFIX:+\$PREFIX/}\$NAME"
`;

/**
 * Build the copyable bash/curl example. Only `mode: "single"` responses are
 * supported; the script stops with a clear error otherwise.
 */
export function buildCurlScript({ serverUrl, prefix }: CliCommandOptions): string {
  return CURL_SCRIPT_TEMPLATE.replaceAll(
    "SERVER_URL_PLACEHOLDER",
    serverUrl || "https://file-server.example.com",
  ).replaceAll(
    "PREFIX_PLACEHOLDER",
    shellQuote(cliPrefix(prefix)),
  ).replaceAll(
    "SMALL_FILE_LIMIT",
    String(SMALL_FILE_LIMIT_MIB),
  );
}
