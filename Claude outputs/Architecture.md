# Architecture — Animesh Hembram Portfolio

## 1. Current Stack

Confirmed by direct inspection, not assumed:

- Plain HTML, CSS, and vanilla JavaScript. No framework (React, Vue, or similar).
- No build step, no bundler, no transpiler.
- No package manager — `package.json` and `node_modules` are absent from the entire repository.
- One external dependency loaded via CDN, animate.css (via cdnjs), plus Google Fonts on about.html.
- No server-side code: there is no `functions/` directory, so Cloudflare Pages serves the site as purely static files.

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

- **Host: Cloudflare Pages** (project `animesh-portfolio-bci`, live at https://animesh-portfolio-bci.pages.dev/), connected to the `AnimeshHembram/Portfolio` GitHub repository. Pushing to `main` triggers a production deployment; other branches get preview deployments.
- **Build settings:** no build command; **build output directory `Frontend`**; root directory = repository root. So `Frontend/index.html` is served at `/`, and `Frontend/assets/…` at `/assets/…`. (If server code is ever added, Pages Functions would go in `functions/` at the repository root, not inside `Frontend/`.)
- Cloudflare Pages serves `*.html` at extensionless URLs (`/day.html` → 308 → `/day`), and with no `404.html` present unknown paths fall back to `index.html` with status 200 — so a mistyped asset path returns HTML, not a 404. Verify asset content types after deploys, not just status codes.
- The case-sensitivity risk in §3 still applies (Cloudflare's filesystem is case-sensitive too).
- Earlier versions of this document said GitHub Pages; that is no longer the host.

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

## 10. Resume View/Download Popover

**What it does.** The dock's Resume icon (`#resumeDockSlot`, on `index.html`, `day.html`, `night.html`) opens a small glass popover (`#resumePopover`) with **View Resume** (opens the PDF in a new tab) and **Download Resume** (downloads it as `Animesh_Hembram_Resume.pdf`). Entirely static — no tracking, analytics, backend or email.

**Files.**
- `Frontend/assets/AnimeshHembramResume 5B.pdf` — the single source of truth for the resume. Because the filename contains a space, every link uses the URL-encoded relative path `assets/AnimeshHembramResume%205B.pdf` (served at `/assets/AnimeshHembramResume%205B.pdf`). Filenames are case-sensitive on Cloudflare (§3), so links must match this exact casing. To update the resume, replace this file keeping the same name — no code change needed.
- Markup (identical on all three pages): the Resume slot is a real `<a href="assets/AnimeshHembramResume%205B.pdf" target="_blank" rel="noopener">`, so it still opens the PDF with JavaScript disabled. The popover markup sits inside `.dock-wrapper`, after `.dock`, holding two `.resume-popover__action` links: View (`target="_blank" rel="noopener"`) and Download (`download="Animesh_Hembram_Resume.pdf"`).
- `Frontend/js/dock.js` — final IIFE: popover open/close only (click, Enter/Space/arrow keys, Escape returns focus to the icon, click-outside, Tab order routed as if the popover followed the icon, viewport-clamped positioning). It never calls `preventDefault` on the two actions, so the browser handles opening/downloading natively.
- `Frontend/css/style.css` — "Resume popover" section; reuses the `--dock-glass-*` tokens plus `--resume-pop-*` tokens, so day and night render identically, like the dock. Night mode's hidden dock stays revealed while the popover is open (it is focus-within/hover-within the dock hover zone).

**Known limitations.**
- Some mobile browsers (notably iOS Safari) open the PDF instead of saving it even from Download; the `download` filename hint only applies where the browser honours it (same-origin, which this is).
- The PDF is public, including the contact details printed in it.
- With no `404.html`, Cloudflare Pages returns `index.html` (status 200) for a mistyped path — after renaming or moving the PDF, check that the link returns `application/pdf`, not HTML.

**Testing.** `node scripts/check-js.mjs` for syntax; then on each of `/`, `/day`, `/night` (and `/?mode=day`, `/?mode=night`): View opens the PDF in a new tab, Download saves `Animesh_Hembram_Resume.pdf`, Escape/outside-click close the popover, and the other dock icons still work.
