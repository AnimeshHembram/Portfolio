# Research — Inspiration, Competitive Landscape, Technical Feasibility

## 1. Existing Inspiration Archive

- The Figma reference file ("Portfolio Website") is the primary visual source for both the day desktop and about.html (node 61:76 specifically).
- Asset folders (`other resources/`, `daytime ui icons/`, `wallpapers/`) are source material for icons, the cursor, and wallpaper images, largely overlapping and duplicated in content, catalogued during the day-UI build-out.
- Prior working screenshots of the implemented night mode and in-progress day mode serve as before/after comparison points during the day-UI work.

## 2. Competitive Portfolio Research

**STATUS: PENDING — placeholder, not yet started.**

This section is scoped (specific competitor portfolios reviewed, what was borrowed, what was deliberately avoided) but intentionally left empty for now. It is tracked as a Phase 1 research task, not a blocker on documentation approval, and should not be read as complete or as "no competitors reviewed" — it simply hasn't been done yet. Replace this notice with actual findings when that Phase 1 task is picked up.

## 3. Technical Feasibility Research

- **Apple design-system analysis** — prior research into materials (glass and blur), depth, and motion restraint, informing the "liquid glass" dock treatment.
- **myos.framer.website** — a reference precedent for a macOS-in-browser portfolio interaction model (dock, desktop icons, window-like content).
- **Liquid-glass effect technique** — sourced from lucasromerodb/liquid-glass-effect-macos, an SVG filter-based approach (feTurbulence, feComponentTransfer, feGaussianBlur, feSpecularLighting, feComposite, feDisplacementMap), confirmed free, open-source, and framework-independent, consistent with the no-new-dependency constraint.
- **Cursor hotspot computation** — solved programmatically by cropping to the alpha-channel bounding box and locating the topmost-then-leftmost opaque pixel, rather than guessing manually, for the day-mode custom cursor.

## 4. Mobile/Touch Feasibility

Scoped for Phase 2, to be filled in as that phase starts. Known starting points:

- CSS `@media (hover: hover)` is already in use to gate the day-mode cursor to pointer devices — the same pattern extends naturally to gating other hover-only interaction styles.
- No touch-drag or pointer-event abstraction exists yet anywhere in the codebase. Phase 4's dragging feature is the first place this will be needed, and Phase 2's audit should establish the approach before Phase 4 starts, per Architecture.md §8.

## 5. Open-Source / Free Tooling Notes

- Google Fonts (Inter, Pixelify Sans, Italianno) — free, already in use on about.html.
- animate.css via cdnjs — a free CDN dependency already in use on index.html.
- No paid libraries, fonts, or services are in use or planned. This is consistent with PRD §8 and should remain the standing default for any future addition.

## 6. Unresolved Questions

- Concrete competitor examples for §2, needed before Phase 3 creative decisions are finalized.
- Whether a lightweight, dependency-free approach using the native Pointer Events API is sufficient for Phase 4 dragging, or whether a small, free, no-build library would meaningfully reduce risk — to be evaluated at the start of Phase 4, not decided now.
