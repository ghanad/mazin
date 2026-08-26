import { NextResponse } from "next/server";
import { CLI_UPLOAD_PROTOCOL_VERSION } from "@/lib/cli/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compatibility contract for the downloadable Python uploader.
 *
 * This is deliberately independent of the web application's release version:
 * the CLI only needs to agree on the upload protocol it uses.
 */
/** GET /api/cli/capabilities — capability negotiation for CLI-only features. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(
    {
      uploadProtocolVersion: CLI_UPLOAD_PROTOCOL_VERSION,
      features: ["directory-upload"],
      downloadUrl: `${origin}/file-server-upload.py`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
