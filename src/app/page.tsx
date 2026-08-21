import { Suspense } from "react";
import FileBrowser from "@/components/FileBrowser";
import { getConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  let bucket: string | null = null;
  try {
    bucket = getConfig().s3Bucket;
  } catch {
    // Configuration errors surface through API error responses instead.
  }

  return (
    <Suspense>
      <FileBrowser bucket={bucket} />
    </Suspense>
  );
}
