# Memory — Development Log

Phase 1 development has begun; this file is now active. It is the running, dated log of in-flight decisions during active development, supplementing the static documents above, which capture stable, agreed-upon state.

## 1. Purpose

Capture decisions, mappings, and course-corrections as they happen during active development — the layer between "we agreed to do X" (this file) and "X is now documented as the standard" (folded back into Design.md or Architecture.md once stable).

## 2. Format

Reverse-chronological dated entries:

```
## YYYY-MM-DD
- What changed or was decided
- Why
- Files touched
```

## 3. Categories to Track

- Approved design decisions (colors, layout choices, asset mappings) as they're finalized.
- Deferred or explicitly rejected ideas, so they aren't re-litigated without new information.
- Bugs found and fixed, especially any that reveal a systemic issue (like the CSS relative-path cursor bug) worth adding to Rules.md.
- Asset naming and casing decisions made during the Phase 1 cleanup.

## 4. Relationship to Other Docs

Memory.md entries are provisional by nature. When a pattern in Memory.md proves stable across multiple entries — a naming convention used consistently, for example — it gets promoted into Rules.md or Design.md as the standing rule, and the Memory.md entries that established it can stay as historical record rather than being deleted.

## Log

## 2026-09-20
- Inspected the live codebase fresh before starting Phase 1 (files had drifted before, so this is standard practice, not a one-off). Confirmed F2–F5 still open (works/socials/more.html and the resume PDF all still missing) and found one new thing: `css/about.css`, a complete but unused second stylesheet for the About page (different class names and fonts than the inline styles `about.html` actually uses — not linked from anywhere). Decision: leave it alone for now, don't reference or delete it; revisit later.
- Implemented F7 (confirmed day/night spec) in `index.html`'s inline script only: threshold corrected to 04:00–22:59 (DAY) / 23:00–03:59 (NIGHT), plus a scheduled-timeout live-update mechanism (recomputes from the real clock each time, so it can't drift) and a `visibilitychange` safety net for throttled background tabs. `?mode=` override preserved and now also disables the live-update loop while active. Night mode untouched. Verified with a 12-case Playwright suite (every boundary edge, both overrides, live transition, override-stays-pinned) — all passed — plus screenshots at 1440×1024 and 390×844 in both modes showing no visual change and no overflow. Committed to `index.html` on the live device.
- Files touched: `index.html` (code); `PRD.md`, `Architecture.md`, `Phases.md`, `Memory.md` (docs).

- **Live-file rollback incident.** A fresh directory listing (done before starting any new work, per standard practice) found `index.html` reverted to a much older pre-Day-UI state — no day desktop, old night-mode markup, old 5am–6pm threshold — sitting next to an unexplained `index-1.html` that was byte-for-byte the correct F7-implemented file. Cause unknown (user didn't know either). Restored `index.html` from `index-1.html`'s content and verified `css/style.css`/`js/main.js` were unaffected (same size and mtime as last known-good). Could not delete `index-1.html` — no device-side delete/move tool available in this session — user needs to remove it manually. Added a rule to Rules.md §2 to always check the directory listing, not just re-read known files, for exactly this reason.
- **Morning aurora overlay, built out of sequence at explicit request** (normally Phase 5 territory; Phase 1 isn't finished). Adapted from a canvas snippet the user supplied: kept the vanilla-JS version, rejected the Tailwind-CDN version to keep zero new dependencies. Original parameters (intensity 0.85) rendered as a near-total repaint of the day gradient rather than a subtle accent — shown via screenshot, then toned down to intensity 0.4 and approved via a second screenshot before shipping. Implemented as a new `js/aurora.js` (canvas transparent-background overlay, `lighter` blend, active 06:00–07:59 via the same boundary-scheduling approach as F7, `?fx=on`/`?fx=off` test override, `prefers-reduced-motion` static-frame fallback) plus a `.day-aurora` CSS rule (z-index above the gradient, below icons/widgets/dock, `pointer-events: none`) and a canvas element added inside `.desktop--day` in `index.html`. Verified with a 12-case Playwright suite (every window boundary, both overrides, non-transparent-pixel check, icon-still-clickable check, night-mode-unaffected check, reduced-motion check) — all passed — plus screenshots at desktop and mobile widths. Committed to the device.
- Files touched: `index.html`, `css/style.css`, `js/aurora.js` (code, both entries above); `Rules.md`, `Architecture.md`, `Design.md`, `Phases.md`, `Memory.md` (docs).
