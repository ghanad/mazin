/**
 * Format bytes using binary units, matching common file-manager behavior.
 * 950 B / 12 KB / 74 MB / 1.6 GB / 9.8 GB
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);

  // One decimal place above 10, none below: 12 KB, 1.6 GB, 9.8 GB
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 1;
  const rounded = Number(value.toFixed(digits));
  return `${rounded} ${units[unit]}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Aug 21, 2026" style dates; falls back to ISO on invalid input. */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Full timestamp for tooltips. */
export function formatDateTime(input: string | Date | null | undefined): string {
  if (!input) return "";
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
