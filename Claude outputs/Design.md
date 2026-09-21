# Design — Living Design Language

This file consolidates everything currently known about the intended design language — prior Apple design-system analysis, notes from myos.framer.website, and the approved Figma reference — into one current, living document. It documents where the implementation stands today, not only the target.

## 1. Design Language Overview

The portfolio's design language borrows macOS's visual and interaction vocabulary — dock, desktop icons, glass materials, day/night desktop wallpapers — reinterpreted through a distinct color identity per mode, rather than a literal macOS skin. Sources consolidated here: an earlier analysis of Apple's design system (materials, depth, motion restraint), reference notes from myos.framer.website (a macOS-in-browser portfolio precedent), and the approved Figma reference for the day desktop specifically.

## 2. Visual Foundations

- **Night mode palette:** the existing, untouched photographic night desktop with its own established look, treated as the baseline identity rather than restyled.
- **Day mode palette (approved):** a terracotta-to-mauve-to-periwinkle gradient (`--day-bg-top: #a94d4f`, `--day-bg-mid: #98658d`, `--day-bg-bottom: #6f8df5`), white-tinted glass (`--day-glass-fill/border/blur/shadow`), and dark-glass widget text cards (`--day-widget-fill/border/text/text-dim`).
- **Typography:** index.html uses system font stacks; about.html uses Inter for nav and body text, Pixelify Sans as a "technology" pillar accent, and Italianno as a "storytelling" pillar accent — currently page-specific rather than site-wide, tracked as an open question in §9.
- **Spacing:** about.html's spacing scale is derived from a specific Figma node (61:76) and is currently independent of index.html's layout spacing.

## 3. Day Mode — Current State

- Bare icons directly on the gradient, with no glass card behind each icon, matching the Figma reference.
- Text-content widgets (weather, date, clock) in dark-glass cards with placeholder text — no live data yet.
- A full-width dock reusing the night dock's liquid-glass shell, with `home.`/`more.` text bookends and the approved icon set and order: News, New York time, Projects, Gallery, About Me, then Gmail, LinkedIn, GitHub, Resume, and YouTube.
- A custom day-mode cursor sourced from a processed `cursor.png`, with its hotspot computed programmatically.
- Known minor issue: the "About Me" dock icon is small and borderline-legible at native dock size, readable at 2x zoom — noted but not yet resolved.
- **Morning aurora overlay (06:00–07:59 only):** a transparent, translucent canvas layered above the gradient and below the icons/widgets/dock — four soft wave bands drifting slowly (aurora-style hues), added with a `lighter` blend so they only ever brighten the existing gradient, never cover it. Tuned to a low intensity (0.4) after an initial pass at the originally-supplied 0.85 read as a near-total repaint of the desktop rather than a subtle accent — approved at the lower value. Active only within the 06:00–07:59 window (same scheduled-boundary technique as the day/night switch in Architecture §4), with a `?fx=on`/`?fx=off` override for testing and a `prefers-reduced-motion` fallback to one static frame. Implemented in `js/aurora.js`, out of the normal Phase sequence — see Phases.md Phase 5 and Memory.md.

## 4. Functional Pages — Design Direction (Hiring-Critical)

The desktop metaphor in §§2-3 and §6 is Goal B territory and does not extend to the hiring-critical pages: about.html (existing) and works.html, socials.html, more.html (to be built in Phase 1). These pages need their own lightweight direction so Phase 1 doesn't build them ad hoc:

- **Starting point:** follow about.html's existing token system (`--color-bg`, `--color-text`, `--color-link`, the Inter/Pixelify Sans/Italianno font trio, its spacing scale) rather than inventing a third system. This is consistent with Architecture §6's plan to consolidate, not multiply, token systems.
- **Visual relationship to the desktop:** these pages are reached by clicking through from the desktop (hotspots, dock, or about.html's own nav) and should read as a calm, content-first counterpart to it — not a second attempt at the macOS chrome. Plain layout, generous type, no glass/dock treatment.
- **Nav consistency:** reuse about.html's existing hamburger-nav pattern and breakpoint behavior on works.html, socials.html, and more.html rather than each page inventing its own header. See Rules.md §3 for the breakpoints this pattern is tested at.
- **Content-specific latitude:** within that shared shell, works.html may need a project-card or list layout, and socials.html a simple link/icon grid — these are content-layout decisions for Phase 1, not a break from the shared visual direction above.

This section is intentionally minimal — it is a direction for Phase 1 to build against, not a finished spec. It should be filled in further once Phase 1 work actually starts.

## 5. Night Mode — Documented As-Is

Night mode is the pre-existing, working baseline: a photographic desktop image with eight clip-path hover hotspots (Works, About, Socials ×2, More, Music toggle, Open to Work, Buy me a Coffee) and a nine-icon liquid-glass dock. It is documented here for completeness and is explicitly not being redesigned under this initiative — see Rules.md §4.

## 6. Shared Components

- **Liquid-glass dock** — one shared filter and class system used by both modes (Architecture.md §5).
- **Cursors** — a JS-driven dot cursor for night mode versus a CSS image cursor for day mode; these are not unified, and don't need to be, since each suits its mode.
- **Hover/hotspot pattern** — invisible regions revealing a floating label, currently mouse-hover-only (see §8 for the touch adaptation this needs).

## 7. Interaction Patterns

- Hover-reveal labels on the night desktop's hotspots.
- Hover-scale on dock icons in both modes.
- A dock "server issue" toast for not-yet-wired actions such as Resume and YouTube in some configurations.
- Planned for Phase 4: drag-to-reposition icons and click-to-open project windows.

## 8. Mobile/Touch Design Adaptations (Open Design Work)

Since the desktop metaphor must work as a first-class experience on touch, each hover-dependent pattern needs an explicit touch equivalent, to be designed in Phase 2:

- Hotspot reveal-on-hover becomes tap-to-reveal-then-tap-to-navigate, or a persistent always-visible label style on touch.
- Dock hover-scale becomes tap feedback (a brief scale or opacity pulse) instead of relying on a hover state that doesn't exist on touch.
- Future dragging needs real touch-drag support via pointer events, not mouse-event-only code.
- Dock and icon sizing and spacing need touch-target-friendly minimums (commonly at least 44px), distinct from the current mouse-oriented sizing.

## 9. Open Design Questions

- Reconciling about.html's typography and spacing system with index.html's: one unified token set, or two deliberately distinct systems kept in sync manually? Flagged in Architecture.md §6, decision deferred to Phase 1 work.
- The "About Me" dock icon's legibility at native size — redraw, relabel, or resize?
- Whether day mode should eventually get a more elaborate custom-cursor treatment beyond the current single cursor image.
