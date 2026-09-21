# Phases — Sequencing Plan

## Guiding Principle

Fix functional gaps that affect the hiring goal before resuming creative UI work. There is a real deadline behind this project, so sequencing isn't just tidy process — it directly protects the higher-stakes goal (a recruiter hitting a dead link or missing resume) from being outranked by lower-stakes polish (a new hover animation).

**Sequencing is not prioritization.** Per PRD §1, Goal A (hiring) and Goal B (creative) are co-equal, not ranked — hiring-critical work is scheduled first in every phase below because it carries the higher near-term risk (a broken link costs an opportunity immediately; a missing hover effect doesn't), not because it matters more. Creative work is not a lesser goal being fit in around the "real" work; it is the other real work, scheduled second for risk reasons.

## Phase 0 — Documentation (current)

- PRD.md, Architecture.md, Rules.md, Phases.md, Design.md, and Research.md drafted and approved.
- Memory.md structure defined, to be populated once Phase 1 development starts.
- No code changes in this phase.

## Phase 1 — Functional Gap Fixes (Hiring-Critical)

- Build `works.html`, `socials.html`, and `more.html` with real content matching existing site conventions — resolves PRD F2–F4.
- Source and add the missing resume PDF, and verify the download link — resolves PRD F5.
- ~~Implement the confirmed day/night spec~~ **Done** — resolves PRD F7. Threshold corrected to 04:00–22:59 (DAY) / 23:00–03:59 (NIGHT); a scheduled-timeout live-update mechanism plus a visibility-change safety net now switch the mode automatically if a tab stays open across a boundary; the `?mode=` override is preserved and pins the mode across boundaries. Night mode's markup, styles, and behavior were not touched. See Architecture.md §4.
- Audit and fix asset-reference casing against GitHub Pages' case-sensitive filesystem (Architecture.md §3).
- Begin reconciling the two design-token systems — index.html/style.css versus about.html — by consolidating values, not rewriting them (Architecture.md §6).

Exit criteria: every link on the site resolves, the resume downloads, day/night reflects real-world hours correctly, and a GitHub Pages deploy is spot-checked for asset 404s.

## Phase 2 — Mobile/Touch-First-Class Pass

- Audit all Phase 1 output, and existing night mode, on real mobile and tablet breakpoints — treated as foundational, not a later add-on, since it affects the hiring goal too (recruiters browsing on phones).
- Convert hover-only interactions (hotspot reveal, dock hover-scale) to touch-equivalent patterns.
- Reconcile the two breakpoint schemes (900/640/420 versus 1024/768) into one coherent responsive strategy across pages.

Exit criteria: every hiring-critical path — About, Works, Socials, resume download, contact — is fully usable via touch alone, on a real phone-width viewport, in both day and night mode.

## Phase 3 — Resume Creative Day-UI Work

- Close remaining gaps between the day desktop and the approved Figma reference (icon and asset polish, widget refinement).
- Complete any remaining asset integration deferred from the earlier day-UI build-out.

## Phase 4 — Interactive Systems

- Desktop icon dragging (free placement).
- A window manager for opening project content in "windows."
- Time-based wallpaper switching, extending beyond the current binary day/night image swap — `assets/wallpapers/` already contains 4am, 5am, 6am, and 9am variants, suggesting the original intent was more granular than the current split.
- All of the above designed touch-first, building on Phase 2's groundwork, rather than mouse-only with touch retrofitted later.

## Phase 5 — Experimental / Stretch

- Additional text and typography animation, creative image transitions, and experimental visual effects not required for either core goal.
- Everything here is explicitly optional against the deadline and is cut first if time runs short.
- ~~Morning aurora overlay (06:00–07:59) on the DAY desktop~~ **Done, out of sequence** — built ahead of Phase 1's completion at explicit request. A translucent, transparent-background canvas layered above the gradient and below the icons/widgets/dock, active only 06:00–07:59 local time via the same scheduled-boundary approach as F7's day/night switch, with a `?fx=on`/`?fx=off` override for testing and a `prefers-reduced-motion` fallback to a single static frame. See Design.md §3 and Memory.md.

## Timeline Notes

Given the stated real urgency, Phases 1–2 are the must-have floor before any deadline. Phase 3 is desirable but negotiable in scope. Phases 4–5 are stretch and can be trimmed or deferred past the deadline entirely without harming the hiring goal.
