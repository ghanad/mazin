---
target: ui/ux review of file browser
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-21T19-30-15Z
slug: src-app-page-tsx
---
# Design Critique — File Server UI (`src/app/page.tsx` + components)

Method: dual-agent (A + B, isolated). Mode: Operate. Live URL: http://localhost:3001

## Design Health Score: 27/40 — Acceptable

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Byte-level progress + skeletons, but no speed/ETA on long uploads; completion silent to SRs |
| 2 | Match System / Real World | 3 | Sort toggle reads "A→Z" even when sorting by Size/Modified (Toolbar.tsx:139) |
| 3 | User Control and Freedom | 3 | Cancel/retry/Esc/clear-filter everywhere; zero undo — delete permanent |
| 4 | Consistency and Standards | 3 | Native window.confirm shatters modal language (FileBrowser.tsx:140) |
| 5 | Error Prevention | 3 | Destructive dialog default-focuses Delete — Enter fires destruction |
| 6 | Recognition Rather Than Recall | 3 | Double-click-to-open documented nowhere |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no multi-select/bulk actions |
| 8 | Aesthetic and Minimalist Design | 3 | Column headers ≈2.6:1 contrast fail AA |
| 9 | Error Recovery | 3 | Copy leaks codes ("Delete failed (502)") |
| 10 | Help and Documentation | 1 | Only title tooltips/placeholders |

Cognitive load: 1 failure of 8 (low). Flag: toolbar decision point exposes 6 controls (Toolbar.tsx:60-151), above ≤4 limit.

## Design Specificity Verdict

Category-interchangeable: Geist + zinc + shadcn-adjacent buttons could ship as any S3 console unchanged. Hand-drawn icon family (icons.tsx) is the one authored element. Ceph/internal-team context (quota, activity, share links) unsurfaced.

Deterministic scan: clean — exit 0, zero findings across src/app/page.tsx, src/app/layout.tsx, all 13 components. Detector agrees with review's "high micro-craft discipline"; no false positives. No browser overlay: MCP extension not connected (2 attempts), no injection surface.

## What's Working

1. State coverage: skeletons, distinct empty-folder vs empty-filter, inline error+retry, drag overlay with destination copy (FileBrowser.tsx:298-340).
2. Upload engine empathy (useUploads.ts): sequential queue, resumable multipart retries, abort cleanup, tabular-nums byte progress, persistent failure rows.
3. Micro-craft coherence: uniform focus-visible rings, prefers-reduced-motion respect (globals.css:82-88), dir="auto" on filenames.

## Priority Issues

- [P1] Destructive confirm focuses Delete button (dialogs.tsx:44, ui.tsx:75-78). Enter on "delete folder" fires instantly. Fix: data-autofocus → Cancel when destructive.
- [P1] Zero RTL/i18n readiness despite Persian-serving signals (layout.tsx:26 lang="en" no dir; latin-only Geist; physical props pl-4/pr-3/ml-auto/left-2.5/rounded-l-md; non-mirroring chevrons; hardcoded EN dates format.ts:24-35; yet stray dir="auto" sprinkles). Fix: commit either way — logical utilities + Intl + Vazirmatn, or declare LTR-only and remove dir="auto".
- [P2] Native window.confirm for overwrite conflict (FileBrowser.tsx:140). Fix: reuse ConfirmDialog naming both files.
- [P2] Focus-management gaps: Modal no focus trap (ui.tsx:64-110); RowMenu role="menu" without roving focus/Esc-restore (FileTable.tsx:25-117); UploadPanel no aria-live.
- [P2] Contrast failures: column headers text-zinc-400 xs uppercase ≈2.6:1 (FileTable.tsx:142-148); item count text-zinc-400 (FileBrowser.tsx:324). Fix: zinc-500 minimum.

## Persona Red Flags

Alex (Power User): hover-gated download icon (FileTable.tsx:260); no "/" search focus, F2/Delete shortcuts; no multi-select; sort via dropdown only, "A→Z" mislabel; no upload ETA/speed; manual-refresh-only sync.
Sam (Accessibility): Tab escapes delete modal; menu opens unfocused/unannounced, arrows dead, Esc loses trigger focus; 2.6:1 headers; zinc-300 separators; upload completion unannounced; 28px row targets; double-click has no keyboard equivalent.
Riley (Stress Tester): duplicate-name upload fails mid-flight though createUpload supports overwrite (api-client.tsx:97, unset by useUploads); rename-conflict strands user post-native-confirm; sticky th inert inside overflow-hidden (FileTable.tsx:142); unvirtualized rows; binary KB/MB vs decimal OS mismatch.

## Minor Observations

Search focus-width animation shifts layout (Toolbar.tsx:73-75); toast stack silently drops >4; unused CopyIcon; execCommand("copy") deprecated fallback (FileBrowser.tsx:80); date tooltip lacks TZ; filter resets on navigation; bare "File Server" title.

## Questions to Consider

- Could sortable column headers absorb sort select+toggle, leaving toolbar Upload/New/Filter with auto-revalidation?
- Should this lean into being the team's Ceph front door (quota, activity, share links)?
- Would a 10-second undo toast beat the confirm modal?
