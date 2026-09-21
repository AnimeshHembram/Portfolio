# Rules — AI Collaboration & Code Conventions

## 1. Purpose

This file governs how AI-assisted work (Claude or otherwise) is done on this codebase, and the code and style conventions that work must follow. It exists so creative experimentation never puts the hiring-critical functionality, or night mode, at risk.

## 2. AI Collaboration Workflow

- **No code before explicit approval.** Any change beyond answering a question requires the user's explicit go-ahead for that specific scope of work. "Approved" language should reference what was approved, not be inferred.
- **Ask instead of guessing.** When an asset, mapping, color value, or intent is ambiguous, present the ambiguity and the options — never silently pick one and proceed.
- **One question at a time** during requirement-gathering phases, to keep decisions traceable.
- **Report before you build.** For any non-trivial visual or structural change, produce a short pre-implementation report — what will change, what won't, open questions — before writing code.
- **Check for drift and duplicate/conflict files, not just content changes.** Files on the live device have unexpectedly reverted to older versions before, once alongside an unexplained `-1`-suffixed duplicate holding the correct content. Fresh inspection before editing (already required) should include a directory listing, not just re-reading the files already known about, so a rollback or stray duplicate is caught before it's built on top of.
- **Flag contradictions.** If a later instruction conflicts with an earlier explicit approval, state the conflict and the interpretation being used, rather than silently resolving it either way.

## 3. Testing Requirements

Every UI change must be verified, before being presented as done, at minimum:

- Desktop-desktop breakpoints already in use on index.html: 1440×1024, 1366×768, 1280×800.
- The functional-page breakpoints already in use on about.html (and to be reused on works.html, socials.html, more.html per Design.md §4): 1024px and 768px. Test both schemes until Architecture.md §6's token/breakpoint reconciliation is complete — a change to either page can otherwise ship untested at the other page's breakpoints.
- Mobile/tablet breakpoints (first-class per PRD and Architecture): at minimum one common phone width (roughly 375–414px) and one tablet width (roughly 768–834px), portrait and landscape where the interaction differs.
- Both `?mode=day` and `?mode=night` explicitly, not just whichever the current clock happens to produce.
- No new horizontal overflow at any tested width.
- No new console errors or failed network requests, asset 404s especially, given the casing risk in Architecture.md §3.
- A before/after screenshot, or equivalent description, accompanies any visual change reported back.

## 4. Protected / No-Touch Areas

The following must not be modified without a separate, explicit approval naming them directly:

- Night-mode markup, styles, and behavior (`.desktop--night` and everything under it).
- `js/main.js`, unless a change specifically requires new JS behavior and that has been called out.
- Any existing working page's core content or copy, unless the task is specifically about that content.

## 5. No-Regression Guardrails

- A change made for Goal B (creative) must never break a Goal A (hiring) requirement, and vice versa — if a trade-off is unavoidable, surface it rather than resolving it silently.
- Existing asset files in source/reference folders (`other resources/`, `daytime ui icons/`, etc.) are read-only references; working copies go into purpose-specific folders (e.g. `assets/day/`) instead of renaming or moving the originals.
- Never introduce a framework, build tool, or package manager as a side effect of an unrelated change.

## 6. Code Conventions

- **CSS custom properties** are the required pattern for any themeable value (colors, spacing tied to a mode) — following the existing `--day-*` variable pattern in `css/style.css` — so values can be tuned centrally later.
- **HTML structure:** day and night desktops remain sibling containers under a shared toggle mechanism (`data-mode`), not merged into one conditional-rendering block — this keeps night mode provably untouched when day mode changes.
- **Shared components** (liquid-glass dock, hover-hotspot pattern) are implemented once and reused, not duplicated per mode.
- **No inline styles** beyond one-off, clearly temporary placeholder work.

## 7. File & Asset Conventions

- New folder and file names: lowercase, hyphen-separated, no spaces. Existing inconsistently-cased folders are not renamed as part of ordinary feature work — only as a dedicated Phase 1 cleanup task, since renaming source folders touches every reference to them.
- Every new asset reference is checked against the actual on-disk filename casing before committing, given the GitHub Pages case-sensitivity risk.
- Processed or working copies of source assets (resized, cropped, renamed) live in their own purpose folder (`assets/day/`, `assets/cursors/`); originals in reference folders are never renamed, moved, or deleted.

## 8. Change Process

A change request should specify: which goal it serves (hiring-critical or creative), which files it touches, what must remain untouched, and what "done" looks like, including which breakpoints and modes to test. Requests that don't specify these are clarified via questions before work starts, per §2.
