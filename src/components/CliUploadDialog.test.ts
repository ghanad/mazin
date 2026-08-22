import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CliUploadDialog } from "./CliUploadDialog";

/**
 * SSR smoke tests: the dialog is a client component, but its markup (tabs,
 * commands, copy/download affordances) can be asserted server-side without
 * adding a DOM dependency to the test suite.
 */
function render(prefix: string) {
  return renderToStaticMarkup(
    createElement(CliUploadDialog, {
      open: true,
      onClose: () => {},
      prefix,
      serverUrl: "https://files.example.com",
    }),
  );
}

/** Extract the rendered Python command block from the markup. */
function pythonCommandOf(prefix: string): string {
  return render(prefix).match(/<code>python3[^<]*<\/code>/)?.[0] ?? "";
}

describe("CliUploadDialog (SSR)", () => {
  it("renders the two tabs with correct roles", () => {
    const html = render("iso/linux/");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tab"');
    expect(html).toContain(">Python</button>");
    expect(html).toContain(">curl</button>");
  });

  it("generates a python command targeting the current prefix", () => {
    expect(pythonCommandOf("iso/linux/")).toContain("--prefix &#x27;iso/linux&#x27;");
  });

  it("omits --prefix at bucket root and says so", () => {
    expect(pythonCommandOf("")).not.toContain("--prefix");
    expect(render("")).toContain("bucket root");
  });

  it("offers a copy button and a script download link", () => {
    const html = render("");
    expect(html).toContain("Copy command");
    expect(html).toContain("Download script");
    expect(html).toMatch(/download="file-server-upload\.py"/);
    expect(html).toMatch(/href="\/file-server-upload\.py"/);
  });

  it("mentions the jq dependency and the curl size limitation", () => {
    const html = render("");
    expect(html).toContain("jq");
    expect(html).toContain("32");
  });
});
