# Infinite Gallery — resource folders

This folder is **storage and organization only**. Nothing in here is read
directly by the browser, and none of these folder names (`images`,
`videos`, `pdf`, `documents`, `presentations`, `github`, `metadata`) ever
appear as text, labels, or categories on the Infinite Canvas. What the
Gallery actually shows is generated from these folders by a script — see
the workflow below.

## Workflow

1. Add a resource under the matching type folder (`images/`, `videos/`,
   `pdf/`, `documents/`, `presentations/`, or `github/`), each project in
   its own subfolder — see the layouts below.
2. Add its preview/thumbnail image, where that type requires one.
3. Add a `metadata.json` next to it (optional — only include fields
   that are actually useful).
4. Run the manifest generator from the project root:
   ```
   python Backend/scripts/generate_gallery_manifest.py
   ```
   (First time only: `pip install Pillow` if the script asks for it.)
5. This regenerates `Frontend/js/infinite-gallery/gallery-manifest.js`.
6. Open `Frontend/infinite-gallery.html` as you already do
   (`file:///...`) — no server needed.
7. The new resource appears in the Infinite Canvas. Clicking/tapping it
   opens the real file (or, for GitHub, the project URL) in a new tab.

If a resource folder has nothing in it yet, the canvas simply renders
empty — the script never invents placeholder content.

## Folder layouts

### images/\<project-name\>/
```
images/sunset-shoot/
├── preview.webp      (optional — auto-generated from the other image
│                       file if you skip it)
├── original.png       (or any other single image file)
└── metadata.json       (optional)
```

### videos/\<project-name\>/
```
videos/reel-01/
├── thumbnail.webp     (REQUIRED — you supply this; the generator never
│                       runs ffmpeg or any other video tool)
├── video.mp4
└── metadata.json       (optional)
```

### pdf/\<project-name\>/, documents/\<project-name\>/, presentations/\<project-name\>/
```
pdf/case-study/
├── preview.webp        (optional per project)
├── case-study.pdf
└── metadata.json        (optional)
```
Until a `preview.*` exists for a project (or a shared
`pdf/_default-icon.webp` / `documents/_default-icon.webp` /
`presentations/_default-icon.webp` exists for the whole type), that
project is skipped rather than shown with an invented icon. Drop in
whichever representation you design later and re-run the generator.

### github/\<project-name\>/
```
github/portfolio-engine/
├── icon.webp            (optional per project — falls back to a shared
│                          github/_default-icon.webp)
└── metadata.json          (REQUIRED — must include "url")
```
The repository itself is never cloned or copied in — only the icon and
the metadata you provide.

### metadata/
Reserved for possible gallery-wide settings later. Not read by the
generator today — each resource's own metadata lives next to it in its
own `metadata.json` instead (see above).

## metadata.json fields

All optional — include only what's useful:

```json
{
  "title": "Project Name",
  "description": "One line about it.",
  "date": "2026",
  "url": "https://github.com/username/repository"
}
```

`url` only matters for `github/` entries (it's required there). If
`title` is omitted, it defaults to a readable version of the project's
own folder name (e.g. `sunset-shoot` → "Sunset Shoot") — never a
generic or type-based label.

## What gets embedded vs. what stays on disk

Only the small preview/thumbnail/icon image for each resource is
embedded into `gallery-manifest.js` (as an optimized, resized WebP data
URI — this is required for the canvas to work when opened directly as a
local file, per the same browser restriction STEP 1's Three.js fix
worked around). The original file — the full-resolution image, the
video, the PDF, the DOC/DOCX, the PPT/PPTX — always stays on disk in
this folder and is only opened when you click/tap the item on the
canvas.
