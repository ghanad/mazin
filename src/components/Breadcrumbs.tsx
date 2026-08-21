"use client";

import Link from "next/link";
import { ChevronRightIcon, FolderIcon } from "./icons";

export function Breadcrumbs({ prefix }: { prefix: string }) {
  const segments = prefix.split("/").filter(Boolean);
  const crumbs = [
    { name: "Home", prefix: "" },
    ...segments.map((name, i) => ({
      name,
      prefix: segments.slice(0, i + 1).join("/"),
    })),
  ];

  return (
    <nav aria-label="Folder path" className="min-w-0 flex-1">
      <ol className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={crumb.prefix || "__root"} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && (
                <ChevronRightIcon
                  width={14}
                  height={14}
                  className="shrink-0 text-zinc-300"
                />
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="flex max-w-[240px] items-center gap-1.5 truncate px-1.5 py-1 text-sm font-medium text-zinc-900"
                  title={crumb.name}
                >
                  {i === 0 ? <HomeGlyph /> : <FolderIcon width={15} height={15} className="text-zinc-400" />}
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={`/?prefix=${encodeURIComponent(crumb.prefix)}`}
                  className="flex max-w-[240px] items-center gap-1.5 truncate rounded px-1.5 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
                  title={crumb.name}
                >
                  {i === 0 && <HomeGlyph />}
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function HomeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-zinc-400"
    >
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" />
      <path d="M9.5 20.5v-6h5v6" />
    </svg>
  );
}
