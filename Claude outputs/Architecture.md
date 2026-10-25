# Architecture — Animesh Hembram Portfolio

## 1. Current Stack

Confirmed by direct inspection, not assumed:

- Plain HTML, CSS, and vanilla JavaScript. No framework (React, Vue, or similar).
- No build step, no bundler, no transpiler.
- No package manager — `package.json` and `node_modules` are absent from the entire repository.
- One external dependency loaded via CDN, animate.css (via cdnjs), plus Google Fonts on about.html.
- **One server-side piece:** a single Cloudflare Pages Function, `functions/api/resume-event.js` (§10). It is plain JavaScript with no dependencies and no build step; Cloudflare compiles it at deploy time. The static site itself is unchanged by it.

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
- **Build settings:** no build command; **build output directory `Frontend`**; root directory = repository root. So `Frontend/index.html` is served at `/`, and **Pages Functions live in `functions/` at the repository root** (not inside `Frontend/`).
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

## 10. Resume View/Download + Email Notifications

**What it does.** The dock's Resume icon (`#resumeDockSlot`, on `index.html`, `day.html`, `night.html`) opens a small glass popover (`#resumePopover`) with **View Resume** (opens the PDF in a new tab) and **Download Resume** (downloads it as `Animesh_Hembram_Resume.pdf`). Each click also sends a best-effort event to `/api/resume-event`, which may email the site owner via Resend.

**Files.**
- `Frontend/assets/resume/animesh-hembram-resume.pdf` — the approved resume (lowercase-hyphen filename per Rules.md §7; the `download` attribute supplies the recruiter-facing name). To update the resume, replace this file keeping the same name.
- Markup: the Resume slot is a real `<a href="…pdf" target="_blank">`, so it still opens the PDF with JavaScript disabled. The popover markup sits inside `.dock-wrapper`, after `.dock`.
- `Frontend/js/dock.js` — final IIFE: popover open/close (click, Enter/Space, Escape, click-outside, routed Tab order, arrow keys), viewport-clamped positioning, and click tracking.
- `Frontend/css/style.css` — "Resume popover" section; reuses the `--dock-glass-*` tokens plus new `--resume-pop-*` tokens, so day and night render identically, like the dock.
- `functions/api/resume-event.js` — the Pages Function. `scripts/test-resume-event.mjs` — its tests.

**Request flow.**
1. Visitor clicks View/Download. The browser follows the link normally — tracking never calls `preventDefault`, so the PDF never depends on the endpoint.
2. In parallel, `dock.js` POSTs `{"type":"view"|"download","page":location.pathname}` as JSON (`fetch` with `keepalive`, `sendBeacon` fallback), at most once per type per tab session (`sessionStorage`).
3. The Function validates, answers immediately, and does the notification work in `waitUntil`.

**Function routing & validation.** `functions/api/resume-event.js` exports `onRequest` → route `/api/resume-event`. Only routes under `functions/` invoke the Function; all static assets stay plain static requests. Checks, in order: method must be POST (else 405 + `Allow: POST`); `Origin` must exactly match one of `ALLOWED_ORIGIN` and `Sec-Fetch-Site`, if present, must be `same-origin` (else 403); `Content-Type: application/json` (else 415); body ≤ 1 KB, enforced while streaming (else 413); JSON object with only `type` ∈ {view, download} and `page` ∈ {`/`, `/index`, `/index.html`, `/day`, `/day.html`, `/night`, `/night.html`} (else 400). Every response body is just `{"ok":true}` or `{"ok":false}` with `Cache-Control: no-store`. The recipient, sender and subject are fixed server-side; nothing in the request can choose them.

**Cloudflare configuration (dashboard — never in source).**
| Name | Kind | Value |
|---|---|---|
| `RESEND_API_KEY` | Secret (encrypted) | Resend API key, *Sending access* only |
| `NOTIFY_EMAIL` | Secret (encrypted) | the Resend account's own email address |
| `ALLOWED_ORIGIN` | Plaintext variable | `https://animesh-portfolio-bci.pages.dev` (comma-separate extra origins, e.g. a preview URL) |
| `RESUME_EVENTS` | KV namespace binding | a KV namespace, e.g. `portfolio-resume-events` |
Set them for **Production** (and Preview, if previews should notify). Changes apply to the **next** deployment.

**Resend.** Free plan: 100 emails/day, 3,000/month. Sender is `Portfolio Alerts <onboarding@resend.dev>`; Resend only lets that test sender deliver to the **email address that owns the Resend account**, so `NOTIFY_EMAIL` must be that address (to use any other recipient, verify a domain you own in Resend and change `FROM_ADDRESS`). Each send carries an `Idempotency-Key` of the event ID. A send counts as delivered-to-provider (`outcome: "sent"`) only when Resend returns 2xx with a message `id`.

**Rate limiting & dedupe (KV, approximate).** Per UTC hour ≤ 10 emails, per UTC day ≤ 40 (both event types combined), plus a 60-second per-type dedupe window. Counters are reserved *before* sending so failures still count (the limiter errs toward fewer emails). KV is eventually consistent, so simultaneous clicks in different Cloudflare locations can briefly exceed a cap. If the `RESUME_EVENTS` binding is missing or KV errors, the Function **fails closed** and sends nothing.

**Logs.** One JSON line per accepted event in Pages → Deployment → Functions real-time logs: `{"fn":"resume-event","event_id","type","outcome",…}` where outcome ∈ `sent` | `deduped` | `rate_limited` | `config_missing` | `kv_unavailable` | `kv_error` | `provider_rejected` (with HTTP status) | `provider_unconfirmed` | `provider_timeout` (5 s) | `provider_unreachable`. API keys, the recipient address and provider response bodies are never logged.

**Privacy.** No IP addresses, user agents, cookies, referrers, fingerprints or visitor identifiers are read, stored, logged or emailed. Emails contain only: event type, UTC timestamp, page, random event ID, and a note that a click is not proof the PDF was saved, opened or read.

**Known limitations.**
- Opening the PDF URL directly, from browser cache, a search engine or a shared link produces no event.
- Ad/tracker blockers, offline clicks, browser quirks and Pages Functions/Resend/KV free-tier limits can drop events; not every click produces an email, and one person can produce more than one (new tab session after the 60 s dedupe window).
- Some mobile browsers (notably iOS Safari) open the PDF instead of saving it even from Download; it is still logged as a download request.
- The PDF is public, including the contact details printed in it.

**Local testing.**
- Unit tests (no dependencies): `node --test scripts/test-resume-event.mjs` from the repo root.
- JS syntax: `node scripts/check-js.mjs`.
- Full local Pages run (Functions + static), without adding package files: `npx wrangler pages dev Frontend --kv RESUME_EVENTS --binding ALLOWED_ORIGIN=http://localhost:8788 --binding RESEND_API_KEY=<key> --binding NOTIFY_EMAIL=<your Resend email>` then open http://localhost:8788. Alternatively put the two secrets in a `.dev.vars` file (git-ignored). Wrangler's `.wrangler/` cache is git-ignored.
