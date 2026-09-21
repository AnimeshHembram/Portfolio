# Frontend Code Audit — 2026-09-21

Read-only audit. Nothing on disk was changed while producing this report — every file below was inspected via a fresh `device_list_dir` + `device_stage_files` pull immediately before writing this, plus a decode of the local Git history. No top menu bar was assumed or proposed anywhere in this report.

---

## A. Current Project Architecture

- **Repo root:** `D:\Projects\Portfolio` — a Git repo (`origin` = `https://github.com/AnimeshHembram/Portfolio.git`, branch `main`) containing three top-level folders: `Frontend/` (the actual site), `Claude outputs/` (screenshots and doc exports from past sessions), and `inspire/` (moodboard/reference images).
- **Site root:** `Frontend/` — `index.html`, `about.html`, `css/`, `js/`, `assets/`. Plain HTML/CSS/vanilla JS, no build step, no framework — confirmed again by fresh inspection.
- **Pages:** `index.html` (desktop landing, day+night), `about.html` (self-contained, inline `<style>`). `works.html`, `socials.html`, `more.html` are linked from `about.html`'s nav but do not exist on disk.
- **Day/night system:** `<html data-mode="day|night">` driven by `index.html`'s inline script, boundary-scheduled live updates, `?mode=` override. Verified unchanged and correct in this pass.
- **Aurora effect:** `js/aurora.js`, a canvas overlay active 06:00–07:59, toggled the same way. Verified unchanged and correct.
- **Shared systems:** liquid-glass dock (`.liquidGlass-*` + one SVG filter), day-mode CSS custom properties in `css/style.css`, `js/main.js` binding hover-hotspots and `[data-dock-action="server-issue"]` globally.

## B. Existing Functionality Worth Preserving

Confirmed working in this pass — do not disturb without explicit sign-off:

- Night-mode desktop: photographic background, 8 hover-hotspots, 9-icon dock, all functioning.
- Day/night automatic switching at the confirmed 04:00/23:00 boundary, with live in-tab updates and the `?mode=` test override.
- Morning aurora overlay (06:00–07:59), toned to intensity 0.4, with `?fx=` override and `prefers-reduced-motion` fallback.
- Day dock's Gmail, LinkedIn, GitHub, Resume-toast, YouTube-toast buttons — these are real, wired interactions (`js/main.js` lines 75–85 for the toast; direct `href`s for Gmail/LinkedIn/GitHub in `index.html` lines 187–195).
- `about.html`'s hamburger nav (toggle + `matchMedia` reset on breakpoint change) — functions correctly, no bugs found.
- Custom cursor: JS dot in night mode, CSS image cursor in day mode, cleanly separated by `data-mode`.

## C. Confirmed Problems

Each item was directly verified against the live file content pulled in this pass.

**C1 — Nine icons across the Day UI look interactive but do nothing.**
`Frontend/index.html` lines 145–148 (`.desktop-icons`: Projects, Music, Gmail, YouTube) and lines 181–185 (day dock: News, New York time, Projects folder, Gallery, About Me) are all bare `<img>` tags — no `href`, no `onclick`, no `data-action`. Yet `css/style.css` lines 644–656 (`.desktop-icon`) and 729–740 (`.dock-icon-img`) give every one of them `cursor: pointer` and a hover-scale animation, which visually promises a click will do something. This is inconsistent with the same dock's Gmail/LinkedIn/GitHub/Resume/YouTube icons (lines 187–201), which *are* wired. **Action:** decide per-icon what a click should do (navigate, open a stub page, or show the same "server issue" toast used elsewhere) before wiring anything — this is a design decision, not just a code fix.

**C2 — Those same nine icons are invisible to keyboard and assistive tech.**
No `tabindex`, no `role="button"`, no `aria-label` on any of the icons in C1. A keyboard-only user cannot reach them at all, despite them appearing clickable to a mouse user. **Action:** once C1's intended behavior is decided, implement it as real `<a>`/`<button>` elements (as the working icons already do) rather than styled `<img>`s — that fixes both problems at once.

**C3 — Resume download link is broken on the live page.**
`Frontend/about.html` line 312: `href="assets/aboutme/Animesh-Hembram-Resume.pdf"`. Confirmed via directory listing: `Frontend/assets/aboutme/` contains no PDF of any name — only PNGs. This is a dead link on a hiring-critical page today, not a future gap. **Action:** add the resume PDF to `assets/aboutme/` (already tracked as PRD F5, now confirmed as an active broken link rather than a "not yet built" item).

**C4 — `works.html`, `socials.html`, `more.html` are 404s from a live page.**
`Frontend/about.html` lines 286–288 link to all three; none exist in `Frontend/`. Already tracked as PRD F2–F4; confirming it's still true and it's reachable from the only functional-content page that exists.

**C5 — `css/about.css` is a complete, unused second design system.**
3,873 bytes, 221 lines, entirely different class names, fonts (`Archivo Black`, `Press Start 2P`, `Playfair Display`) and spacing scale than what `about.html` actually uses (its own inline `:root` token set with Inter/Pixelify Sans/Italianno). Confirmed via direct inspection: nothing in `about.html` links to `css/about.css` — it only has the inline `<style>` block. Zero deploy risk since nothing references it, but it's dead weight. Per your earlier instruction this stays untouched for now; listed here only so it's in one place with everything else. **Action:** none yet — you already said leave it alone.

**C6 — `?mode=` override edge case (minor).**
`Frontend/index.html` line 69: `if (!override) { ... }`. Any non-empty `?mode=` value other than exactly `day` or `night` (a typo, a stray param) is still truthy, so the live-update loop never starts and the page silently freezes at whatever the real clock produced on load. **Action:** tighten the condition to `if (override !== "day" && override !== "night")` so an unrecognized value falls back to normal live behavior instead of silently freezing.

**C7 — Git history is a week stale; nothing from Phase 1 is committed or pushed.**
Decoded directly from `.git/objects` (not assumed): the repo has exactly **one commit**, `"Initial portfolio"`, made 2026-09-14 01:19 IST, and nothing since — no further commits, no pulls, no fetches (confirmed via the reflog, which has only the initial commit and a branch rename, both from that same minute). The tree captured in that commit contains `Frontend/assets`, `Frontend/css`, `Frontend/index.html`, `Frontend/js` — **`about.html` did not exist yet at commit time** and is not in the repo at all. Every piece of Phase 1 work in this conversation (the F7 day/night implementation, the about page, the aurora effect, all current assets) exists only on your local disk. **If GitHub Pages is live from this repo today, the deployed site is the pre-Phase-1 version with no about page.** **Action:** you'll want to `git add` / commit / push once you're ready to deploy the current state — this is a deployment-readiness gap, not a code bug, so I'm flagging it rather than touching git myself.

**C8 — The repo's only commit also tracks `Claude outputs/` and `inspire/` as top-level folders, and there's no `.gitignore`.**
Confirmed by decoding the root tree object: it has three entries — `Claude outputs`, `Frontend`, `inspire` — sitting as siblings, not `Frontend` alone. `Claude outputs/` holds screenshots and doc exports (some 1–2 MB each); `inspire/` holds ~40 moodboard/reference images, several over 1.5 MB, one over 2.2 MB. No `.gitignore` exists anywhere in the repo to keep these out of future commits. **This matters for two reasons:** first, if GitHub Pages serves from this repo's root rather than from `/Frontend`, your public site's root would show these folders too, not just the portfolio; second, every future `git add .` will keep pulling multi-megabyte reference images into the repository's permanent history, bloating it indefinitely. **Action:** before your next commit, add a `.gitignore` for `Claude outputs/` and `inspire/` (or move them outside the repo entirely), and confirm in your GitHub repo settings whether Pages is configured to serve from the repo root or needs to point at `/Frontend` — I can't see your Pages settings from here, so this needs your own check.

## D. Potential Problems Requiring Verification

**D1 — Possible asset/name mismatch: "Music" desktop icon.**
`Frontend/index.html` line 146 uses `assets/day/music-bg.png` for the Music icon. The `-bg` suffix suggests it may have been intended as a background/texture asset rather than a dedicated app-icon glyph. Not confirmed as wrong without seeing the image rendered at icon size — flagging for your visual check, not asserting it's broken.

**D2 — Mobile landscape crowding, untested.**
`.desktop-icons` (top-left, fixed) and `.widget-cluster` (top-right, fixed) both anchor near the top of the viewport, with the dock fixed at the bottom. On a short viewport (phone in landscape, roughly 667×375 and smaller), these three fixed regions have less vertical room to coexist. This hasn't been screenshotted at that specific orientation per Rules.md §3's own breakpoint list. Not a confirmed bug — just untested territory worth a screenshot before calling mobile "done."

**D3 — Hover-only discovery on touch devices.**
`js/main.js` lines 48–68: hotspot interaction is built entirely on `mouseenter`/`mouseleave`, plus `click` only for hotspots that carry `data-href` (currently just "About me", line 115 of `index.html`). On a touch device, `mouseenter` never fires, so the other six night-mode hotspots (Works, Socials ×2, More, Music, Open-to-work, Coffee) are undiscoverable — no visual affordance, no tap target feedback. This is already tracked as open design work in Design.md §8; confirming here that it's a real, current gap in the shipped code, not just a design placeholder. Since night mode is a protected no-touch area (Rules.md §4), any fix here needs its own explicit approval.

**D4 — GitHub Pages source path, unconfirmed.**
Related to C7/C8: I don't have visibility into your actual GitHub Pages configuration (repo Settings → Pages) from this session. If it's set to serve from the repo root, your live URL structure would be `username.github.io/Portfolio/Frontend/...` rather than a clean root URL — worth confirming directly on GitHub.

## E. Duplicate Files and Their Differences

- **`Frontend/index-1.html` vs `Frontend/index.html`** — no longer identical. `index-1.html` (12,816 bytes) is the file used to restore `index.html` after the first revert incident (11 days ago in file-time terms, before the aurora work); it predates the aurora feature. `index.html` (13,236 bytes, current) is correct and current — it has the aurora `<canvas>` (lines 135–139) and the `js/aurora.js` script tag (line 307) that `index-1.html` lacks. **This is expected staleness, not a new corruption** — `index-1.html` is simply an orphaned leftover that was never updated after serving its one-time restore purpose.
- **`Frontend/css/style-1.css` vs `Frontend/css/style.css`** — byte-for-byte **identical** as of this pass (both 17,874 bytes). `style.css`'s on-disk modified time is about 21.7 hours newer than `style-1.css`'s, but the content is unchanged — that gap is consistent with the file being closed/saved again by an editor, not a new revert. **No active corruption present in either file right now.**
- **Recommendation for both:** safe to delete once you're comfortable — see Section J. I still can't delete device files from this session (no shell access to your machine here), so this needs to happen on your end.

### File-Revert Investigation — Confirmed vs. Possible

**Confirmed (with evidence):**
- Git is **not** the cause. The repo's entire history is one commit + one branch rename, both timestamped 2026-09-14 01:19–01:20 IST — before Phase 1 work began and days before either revert incident. There has been no `pull`, `fetch`, `checkout`, `reset`, or any other ref-changing git operation since. This rules out git auto-sync, a background `git pull`, or a stash/checkout mistake as the mechanism.
- As of this pass, neither `index.html` nor `style.css` shows any active reversion — both hold their correct, current content. Whatever caused the two past incidents is not actively recurring right now.

**Possible, unconfirmed (listed as candidates, not conclusions — I have no access to your running processes, OS-level file logs, or app settings from this session):**
- Your machine has config folders for several other AI coding tools alongside Claude — `.antigravity`, `.codex`, `.copilot`, `.gemini`, `.ollama` were all visible in your home directory listing. If any of these (or another agent/session within one of them) was also pointed at this same `Frontend` folder around the time of either incident, its own checkpoint or "safe write" behavior — reverting to a snapshot it held while also writing the newer content to a sibling file — would produce exactly the pattern you saw (old content restored to the original name, correct content preserved under a `-1` name). This is circumstantial (their presence doesn't prove they touched this folder) and would need to be confirmed on your end — e.g., checking whether any of those tools had a session open against `D:\Projects\Portfolio` around the time of either revert.
- A sync/backup tool (OneDrive, an antivirus quarantine-and-restore feature, etc.) — weaker candidate here, since `D:\Projects\Portfolio` sits on `D:\`, outside the default OneDrive-synced user-profile folders, but I can't rule it out without seeing your OneDrive folder settings directly.
- Editor-level local history/autosave conflict resolution (e.g., a VS Code extension) — plausible given `.vscode` is present on the machine, but no direct evidence either way.

## F. Priority Classification

- **Critical:** C7 (git a week stale, about.html not even committed), C8 (repo tracks `Claude outputs`/`inspire`, no `.gitignore`), D4 (Pages source path unconfirmed) — these three together determine whether what recruiters would actually see is the current site at all.
- **High:** C1/C2 (nine dead-looking-but-live icons, plus their accessibility gap), C3 (broken resume link on a hiring-critical page).
- **Medium:** C4 (works/socials/more 404s — already tracked, re-confirmed), D3 (touch discoverability of night hotspots), D2 (mobile-landscape crowding, untested).
- **Low:** C6 (`?mode=` edge case), D1 (music icon asset naming).
- **No action needed / informational:** C5 (orphaned about.css — leave as instructed), Section E's duplicate files (safe cleanup, not urgent).

## G. Recommended Redesign Sequence

This is a suggested order, not a decision — nothing here is approved or started:

1. Resolve C7/C8/D4 first (git + `.gitignore` + confirm Pages source). Everything else is invisible to a recruiter until this is right.
2. Decide the intended behavior for the nine icons in C1, then fix C1+C2 together as one pass (real interactive elements, not styled `<img>`s).
3. Add the resume PDF (C3) — quick, high-value for the hiring goal.
4. Build `works.html`/`socials.html`/`more.html` (C4) — needs your content first.
5. Touch-equivalent interactions for night-mode hotspots (D3) — protected area, needs its own explicit approval per Rules.md §4.
6. Mobile-landscape verification screenshot (D2) and the `?mode=` edge-case fix (C6) — low-risk, can slot in anywhere.

## H. Files That Need Modification (once you approve specific items above)

- `Frontend/index.html` — C1/C2 (icon markup), C6 (override condition).
- `Frontend/css/style.css` — C1/C2 (styles for whatever the new interactive markup becomes).
- `Frontend/about.html` — C3 (once the PDF exists, the link itself is already correct).
- Repo root — a new `.gitignore` (C8); a commit + push (C7) — these are git operations on your machine, not file edits I'd make.

## I. Files That Should Remain Unchanged

- Everything under night mode (`.desktop--night` and its markup/styles/behavior) — protected per Rules.md §4 unless separately approved.
- `js/main.js` — unless a specific new behavior is called out (e.g., wiring C1's icons would touch this).
- `js/aurora.js`, the day/night boundary script in `index.html`, and `css/about.css` — all verified correct/intentionally-untouched in this pass.

## J. Safe Cleanup Recommendations

- Delete `Frontend/index-1.html` and `Frontend/css/style-1.css` — confirmed stale/duplicate, no unique content worth keeping (I can't delete device files from this session — this needs to happen on your end).
- Add a `.gitignore` covering `Claude outputs/` and `inspire/` before the next commit (see C8).
- Several icon assets are duplicated verbatim across `assets/dock/`, `assets/daytime ui icons/`, and `assets/other resources/` (e.g. `github.png`, `gmail.png`, `linkedin.png`, `resume.png`, `youtube.png`, `map.png`, `notes.png` all appear byte-identical in more than one of these folders). This matches Rules.md §7's read-only-reference-folder pattern, so it isn't wrong, but it's worth knowing these are copies, not independent assets, if you ever prune the reference folders.

---

**No files were modified, renamed, or deleted in the course of this audit.** Waiting for your go-ahead on which of the above to act on.
