import { getConfig } from "@/lib/env";

/**
 * Resolve the public base URL used for stable direct-download links.
 *
 * APP_BASE_URL always wins (required behind ingress/proxies where the
 * container cannot guess its own public hostname). When unset — e.g. local
 * development — fall back to the incoming request's host.
 */
export function getBaseUrl(request: Request): string {
  const configured = getConfig().appBaseUrl;
  if (configured) return configured;

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
