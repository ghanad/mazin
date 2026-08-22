import { describe, expect, it } from "vitest";
import {
  SMALL_FILE_LIMIT_MIB,
  buildCurlScript,
  buildPythonCommand,
  cliPrefix,
} from "./commands";

describe("cliPrefix", () => {
  it("strips trailing slashes used by the UI", () => {
    expect(cliPrefix("iso/linux/")).toBe("iso/linux");
    expect(cliPrefix("iso/")).toBe("iso");
    expect(cliPrefix("a/b//")).toBe("a/b");
  });

  it("returns an empty string for the bucket root", () => {
    expect(cliPrefix("")).toBe("");
    expect(cliPrefix("/")).toBe("");
  });
});

describe("buildPythonCommand", () => {
  it("includes server and file, and no --prefix at bucket root", () => {
    const cmd = buildPythonCommand({ serverUrl: "https://files.example.com", prefix: "" });
    expect(cmd).toBe(
      "python3 file-server-upload.py \\\n" +
        "    --server 'https://files.example.com' \\\n" +
        "    --file ./path/to/file.bin",
    );
    expect(cmd).not.toContain("--prefix");
  });

  it("bakes in the currently open folder as destination prefix", () => {
    const cmd = buildPythonCommand({ serverUrl: "https://x.test", prefix: "iso/linux/" });
    expect(cmd).toContain("--prefix 'iso/linux'");
  });

  it("safely quotes spaces and single quotes", () => {
    const cmd = buildPythonCommand({ serverUrl: "https://x.test", prefix: "Ali's Files/" });
    expect(cmd).toContain("--prefix 'Ali'\\''s Files'");
  });

  it("quotes a server URL containing special characters", () => {
    const cmd = buildPythonCommand({ serverUrl: "http://10.0.0.5:3000", prefix: "" });
    expect(cmd).toContain("'http://10.0.0.5:3000'");
  });
});

describe("buildCurlScript", () => {
  const script = buildCurlScript({ serverUrl: "https://files.example.com", prefix: "iso/linux/" });

  it("targets the current folder with safe quoting", () => {
    expect(script).toContain("PREFIX='iso/linux'");
  });

  it("bakes in the server URL", () => {
    expect(script).toContain("SERVER=https://files.example.com");
  });

  it("documents jq as a dependency", () => {
    expect(script).toMatch(/jq must be installed/i);
  });

  it("documents the single-mode size limitation", () => {
    expect(script).toContain(`including ${SMALL_FILE_LIMIT_MIB} MiB`);
  });

  it("stops on multipart mode and points to the Python script", () => {
    expect(script).toContain('[ "$MODE" != "single" ]');
    expect(script).toContain("python3 file-server-upload.py");
    expect(script).toContain("exit 1");
  });

  it("calls the create API then uploads directly with curl", () => {
    expect(script).toContain('POST "$SERVER/api/uploads/create"');
    expect(script).toContain("--upload-file \"$FILE\"");
    expect(script).toContain('"$URL"');
  });

  it("never echoes the presigned URL (it embeds temporary credentials)", () => {
    for (const line of script.split("\n")) {
      if (/echo/.test(line)) expect(line).not.toContain("$URL");
    }
  });

  it("handles filenames with spaces via quoting", () => {
    expect(script).toContain('NAME="$(basename "$FILE")"');
    expect(script).toContain('SIZE=$(stat -c%s "$FILE")');
  });
});
