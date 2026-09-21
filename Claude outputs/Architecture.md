# Architecture — Animesh Hembram Portfolio

## 1. Current Stack

Confirmed by direct inspection, not assumed:

- Plain HTML, CSS, and vanilla JavaScript. No framework (React, Vue, or similar).
- No build step, no bundler, no transpiler.
- No package manager — `package.json` and `node_modules` are absent from the entire repository.
- One external dependency loaded via CDN, animate.css (via cdnjs), plus Google Fonts on about.html.

This stack is a hard constraint (PRD §8) and is preserved through every phase in Phases.md.

## 2. Page Inventory

- `index.html` — the main desktop landing page. Contains both the NIGHT desktop (`main.landing.desktop.desktop--night`) and the DAY desktop (`div.desktop.desktop--day`) as sibling elements, toggled by a `data-mode` attribute on `<html>`.
- `about.html` — a fully self-contained About page: its own inline `<style>` block, its own `:root` token system (sourced from a different Figma node than index.html), its own responsive breakpoints at 1024px and 768px (versus index.html's 900/640/420px), and a hamburger nav with inline `<script>`.
- `works.html`, `socials.html`, `more.html` — referenced by about.html's navigation but do not exist. Tracked as functional gaps (PRD F2–F4).

## 3. File/Folder Structure and Casing Risk

Assets live under `assets/`, organized by purpose (`dock/`, `day/`, `aboutme/`, `cursors/`, `wallpapers/`, plus source and reference folders such as `other resources/` and `daytime ui icons/`). Several folder names carry inconsistent casing and embedded spaces — `assets/Socials/`, `assets/Works/`, `assets/other resources/`, `assets/New folder/`. This is invisible on Windows, which is case-insensitive, but GitHub Pages serves from a case-sensitive filesystem: a link or `src` that doesn't match a folder's exact on-disk case will 404 in production even though it works perfectly in local testing. Mitigation is tracked as a Phase 1 task in Phases.md — audit every asset reference against actual on-disk casing before each deploy, and standardize naming for anything new (Rules.md §7).

## 4. Day/Night Mode System (Implemented, Phase 1)

**Spec:** DAY UI 04:00–22:59 local time, NIGHT UI 23:00–03:59 local time, switching automatically and exactly at those boundaries, based on the visitor's own device clock, with the interface updating live if the tab is left open across a transition — no manual refresh required.

**Implementation**, in `index.html`'s inline script:

- `computeIsDay()` reads the visitor's local hour via `new Date().getHours()` and returns true for `hour >= 4 && hour < 23` — matching the DAY 04:00–22:59 / NIGHT 23:00–03:59 spec exactly.
- `applyMode(isDay)` stamps `<html data-mode="day"|"night">` and swaps `#landingImage`'s `src` between `assets/images/landing-day.webp` and `assets/images/landing.webp` — unchanged from before.
- Live update: `scheduleNextCheck()` computes the exact number of milliseconds until the next 04:00 or 23:00 boundary and sets a single `setTimeout` for that moment (plus a 1s buffer so it lands just after, never just before). When it fires, it re-evaluates the real clock, applies the mode if it changed, and reschedules itself for the following boundary — this recomputes from `Date()` every time rather than counting elapsed time, so it self-corrects and can't drift.
- Safety net: a `visibilitychange` listener re-checks the mode immediately whenever the tab regains focus, covering the case where a backgrounded tab's timer was throttled by the browser and fired late.
- The `?mode=day` / `?mode=night` URL override is preserved exactly as before, and now also skips setting up the live-update loop entirely — a pinned test mode stays pinned even across a real boundary crossing.

Night-mode markup, styling, and behavior were not touched — this is additive scheduling/switching logic layered on top of the existing toggle mechanism, not a change to what either mode looks like (Rules.md §4).

**Verification:** a 12-case Playwright suite (a mocked `Date` per case) covering every boundary edge (03:59/04:00/04:01, 22:59/23:00/23:01, midday, post-midnight), both URL overrides, an in-page live transition across the 23:00 boundary with no reload, and confirmation that an active override stays pinned across a boundary — all 12 passed. Screenshots at 1440×1024 and 390×844, in both modes, showed no visual change and no horizontal overflow.

## 5. Shared Systems

- **Liquid-glass dock component** — a reusable set of classes (`.liquidGlass-wrapper`, `-effect`, `-tint`, `-shine`, `-text`) plus one shared SVG `<filter id="glass-distortion">`, used identically by both the night dock and the day dock. Any future dock variant should reuse this filter rather than duplicating it.
- **Cursor system** — night mode uses a JS-driven custom cursor dot (`#cursor`, following `mousemove` in `js/main.js`); day mode uses a CSS image cursor via `cursor: url(...)`. Note the relative-path behavior: a `url(...)` inside `css/style.css` resolves relative to the CSS file's own folder, not the HTML's — any new cursor or background asset referenced from CSS must account for this.
- **Hover-hotspot pattern** — invisible clip-path regions over the night desktop image, each carrying `data-title`/`data-desc`, revealing a floating label on hover and driving navigation or toast messages via `js/main.js`.
- **Dock action wiring** — `js/main.js` binds `[data-dock-action="server-issue"]` globally via `querySelectorAll`, so both the night dock and the day dock's Resume/YouTube buttons are wired automatically with no JS duplication.

## 6. Design-Token Systems (Currently Fragmented)

Two independent CSS custom-property systems currently coexist:

- `css/style.css` — day-mode tokens (`--day-bg-*`, `--day-glass-*`, `--day-widget-*`) sitting alongside the pre-existing night-mode styling above it.
- `about.html`'s inline `:root` — an entirely separate token set (`--color-bg`, `--color-text`, font variables, spacing variables) sourced from a different Figma node, with its own breakpoint scheme.

These are not currently reconciled. Design.md documents both as the current language; consolidating them into one consistent token system is scoped as a Phase 1/2 task — a consolidation of existing values, not a rewrite.

## 7. Deployment

- Target: GitHub Pages, serving directly from Animesh's existing `AnimeshHembram/Portfolio` GitHub repository, `main` branch.
- No CI or build step — GitHub Pages serves the static files as-is, consistent with the no-build-tool constraint.
- Deployment risk is almost entirely the case-sensitivity issue in §3; there is no server-side risk since there is no server logic.

## 8. Mobile/Touch Architecture (First-Class, Not Degraded)

Full responsive support, including mobile and tablet, is a first-class requirement (PRD §9), not a best-effort fallback. This has direct architectural consequences:

- Hover-based interactions (hotspot reveal-on-hover, dock icon hover-scale) need touch-equivalent trigger patterns — tap-to-reveal, tap-to-open — rather than being silently unreachable on touch devices.
- Any future dragging or window-manager system (Phase 4) must be designed with pointer-event abstractions, or explicit touch handlers, from the start rather than retrofitted after a mouse-only implementation. Retrofitting is the primary technical risk called out in Research.md.
- Layout breakpoints need re-auditing once both goals — hiring content and creative desktop — are live across the same page set, since about.html and index.html currently use two different breakpoint schemes (§6).

## 9. Extension Points

Planned future systems and where they attach:

- **Icon dragging** attaches to `.desktop-icon` / `.dock-icon-img` elements; a persistence layer (likely `localStorage`, free and backend-free) would be needed if positions should survive a reload.
- **Window manager** is a new top-level container sibling to the existing desktop divs, opened by dock or icon interactions, and must not interfere with the day/night toggle logic.
- **Time-based wallpaper switching** extends the existing hour-check script in `index.html`; wallpaper assets already exist in `assets/wallpapers/` (4am, 5am, 6am, 9am variants), suggesting the original intent was more granular than the current binary day/night split.
- **Morning aurora overlay** (`js/aurora.js`, built out of sequence — see Phases.md Phase 5): a first example of this pattern. A dedicated script file, loaded via its own `<script defer>` tag rather than folded into `index.html`'s inline script, owns a `<canvas>` layered inside `.desktop--day` and toggles it on a schedule using the same boundary-timeout technique as the day/night switch. This is the template for any future sub-window effect: own script file, own scheduling loop mirroring §4's pattern, transparent canvas background so it only adds to what's beneath it, and a `?fx=`-style override for testing.
