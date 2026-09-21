# Product Requirements Document — Animesh Hembram Portfolio

## 1. Overview

This portfolio is a single static site (no framework, no build tool) presenting Animesh Hembram's work as a macOS-inspired interactive desktop, with distinct DAY and NIGHT visual modes tied to the visitor's local time. It exists to serve two goals that are tracked, and validated, separately for the rest of these documents:

- **Goal A — Portfolio for Hiring.** A recruiter, hiring manager, or client can, within seconds, find who Animesh is, see representative work, download a resume, and reach him — without needing to engage with the creative desktop metaphor at all.
- **Goal B — Portfolio as Creative Showcase.** The same site demonstrates Animesh's interaction-design and front-end craft: the playful desktop metaphor, the liquid-glass dock, the day/night system, hover reveals, and (later) dragging and window management.

These goals are treated as **distinct and co-equal**, not merged into one blended success metric. A change that improves one must not silently regress the other — see Rules.md §5 (No-Regression Guardrails).

## 2. Audience

Two audience framings apply simultaneously, not exclusively:

1. Hiring managers and craft-focused visitors evaluating Animesh's design/engineering ability.
2. Recruiters and people encountering him through active job-search / personal-brand channels (LinkedIn, resume links, cold outreach) who need fast, low-friction access to credentials.

Both audiences may be the same visitor at different moments — a recruiter who is delighted by the desktop metaphor, then wants the resume. The site should not force a choice between charm and clarity.

## 3. Goal A: Portfolio for Hiring — Requirements & Success Criteria

Functional, hiring-critical (full checklist in §6):

- A visitor can reach a working About/Bio page.
- A visitor can download an up-to-date resume PDF in two clicks or fewer from the landing page.
- A visitor can reach real project write-ups (Works) with no dead links.
- A visitor can find contact methods (email, LinkedIn, GitHub) without hunting.
- All of the above work on mobile and tablet, not just desktop.

Success is a time-pressed recruiter completing "find resume" or "find contact" in under 15 seconds, on any device, in either day or night mode.

## 4. Goal B: Portfolio as Creative Showcase — Requirements & Success Criteria

Creative and experimental (full list in §7):

- Day/Night desktop modes with distinct, polished visual identities.
- Liquid-glass dock, animated icons, hover-reveal hotspots.
- Future: draggable icons, a window manager for project "windows," time-based wallpaper transitions.
- Smooth typography and text animation, creative image transitions, experimental visual effects.

Success is a visitor who explores beyond the first click perceiving genuine craft and interaction-design sensibility, on both desktop and touch devices.

## 5. Non-Goals

- Not a CMS or blogging platform — content changes are manual, direct edits.
- Not framework-driven — no migration to React, Vue, Svelte, or similar under this PRD.
- Not multi-tenant, not localized, not e-commerce.
- Not dependent on paid services, paid hosting, or accounts beyond Animesh's existing GitHub account.

## 6. Functional Requirements (Hiring-Critical)

| # | Requirement | Status |
|---|---|---|
| F1 | Working About page | Done (about.html) |
| F2 | Working Works/projects page | Missing — works.html is referenced but does not exist |
| F3 | Working Socials page | Missing — socials.html is referenced but does not exist |
| F4 | Working "More" page | Missing — more.html is referenced but does not exist |
| F5 | Downloadable resume PDF | Missing — linked, file absent |
| F6 | Contact links (email/LinkedIn/GitHub) | Done, in the dock |
| F7 | Day/night switches automatically at the visitor's local time, at exact boundaries, and updates live if the tab stays open across a transition (no manual refresh needed) | **Done.** DAY UI 04:00–22:59, NIGHT UI 23:00–03:59, switching exactly at 04:00 and 23:00; a scheduled re-check plus a visibility-change safety net handle the live-update case; `?mode=day` / `?mode=night` still pins the mode for testing. Implemented in `index.html`'s inline script only — night mode's markup/CSS untouched. Verified with a 12-case automated test (every boundary, both overrides, live transition, override-stays-pinned) plus screenshots at desktop and mobile widths in both modes. See Architecture.md §4. |
| F8 | Mobile/tablet functional parity for all of the above | Not yet audited — resolved by Phase 2's exit criteria in Phases.md, not Phase 1's; listed as hiring-critical here because the requirement itself is non-negotiable, even though its fix is sequenced into Phase 2 |

(Table form is used here only because this is a literal status checklist; every other section in this file uses prose per house style.)

## 7. Creative / Experimental Requirements (Non-Blocking for Hiring Goal)

- Desktop icon dragging (free placement) — discussed, not yet implemented.
- A window manager for opening "project window" content.
- Time-based wallpaper switching beyond the current binary day/night image swap.
- Additional micro-interactions, text animation, and transition experiments.

These are sequenced after Section 6 is resolved, per Phases.md.

## 8. Constraints

- **Hosting:** GitHub Pages only, on Animesh's existing GitHub account — no new hosting platform or account.
- **Stack:** existing HTML/CSS/JavaScript only — no framework migration, no build tooling, no package manager introduced.
- **Dependencies:** free and open-source only; no new paid services.
- **Preservation:** existing working features, especially the night-mode experience, must not regress.
- **Timeline:** there is a real deadline tied to the job search — see Phases.md for sequencing under that constraint.

## 9. Risks (tracked in depth in Architecture.md and Design.md)

- **Mobile/touch parity risk:** the macOS desktop metaphor (dock, drag, window manager) must be genuinely redesigned for touch, not allowed to merely degrade gracefully.
- **Case-sensitivity risk:** GitHub Pages serves from a case-sensitive filesystem; several existing asset folders have inconsistent casing and embedded spaces that work locally on Windows but could 404 in production.
- **Token-system fragmentation risk:** index.html/style.css and about.html currently use two independent, unreconciled design-token systems.
