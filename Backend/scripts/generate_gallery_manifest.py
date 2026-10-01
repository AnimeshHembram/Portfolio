#!/usr/bin/env python3
# ---------------------------------------------------------------------
# Infinite Gallery — manifest generator
# ---------------------------------------------------------------------
# Scans Backend/resources/infinite gallery/ and writes
# Frontend/js/infinite-gallery/gallery-manifest.js — a plain classic
# <script> file (no build step, matches the rest of the portfolio) that
# defines window.InfiniteGallery.GALLERY_MANIFEST as a flat array of
# {url, width, height, title, ...} items in exactly the shape the
# existing Infinite Gallery engine (scene.js / texture-manager.js)
# already expects. The engine itself is never touched by this script.
#
# Run manually, from anywhere, whenever resources change:
#   python Backend/scripts/generate_gallery_manifest.py
#
# Requires: Python 3.8+ and Pillow (`pip install Pillow`).
#
# ---------------------------------------------------------------------
# WHY DATA URIs
# ---------------------------------------------------------------------
# The Gallery page is opened directly as a local file
# (file:///.../Frontend/infinite-gallery.html), never through a server.
# Browsers refuse to upload a file://-loaded image into a WebGL texture
# (a same-origin restriction with no plain-file-path workaround — this
# is exactly the bug STEP 1 hit and fixed). The only way to feed WebGL
# an image under file:// is to embed its pixel data directly in the
# document as a data: URI. So this script converts each resource's
# small PREVIEW image to an optimized WebP and inlines *that* as a data
# URI. It never inlines full-resolution originals, PDFs, DOC/DOCX,
# PPT/PPTX, or video files — those stay on disk and are only opened
# (via a relative file link) when the user interacts with the item on
# the canvas.
#
# ---------------------------------------------------------------------
# FOLDER CONVENTION (see resources/infinite gallery/README.md for the
# full walkthrough)
# ---------------------------------------------------------------------
#   images/<project>/
#       preview.webp|.jpg|.png   (optional — auto-generated from the
#                                  original if missing)
#       original.<ext>            (or any other single image file)
#       metadata.json              (optional)
#
#   videos/<project>/
#       thumbnail.webp|.jpg|.png  (REQUIRED — supplied by you; this
#                                  script never runs ffmpeg or any other
#                                  video tool)
#       video.mp4|.webm|.mov      (or any other single video file)
#       metadata.json              (optional)
#
#   pdf/<project>/ , documents/<project>/ , presentations/<project>/
#       preview.webp|.jpg|.png    (optional per project) — falls back to
#                                  pdf/_default-icon.* (or documents/…,
#                                  presentations/…) if you drop one
#                                  shared icon there instead
#       <the .pdf / .doc(x) / .ppt(x) file>
#       metadata.json              (optional)
#       If neither a per-project preview nor a type-level default icon
#       exists yet, the project is skipped (not shown with a fake
#       icon) until you supply one.
#
#   github/<project>/
#       icon.webp|.jpg|.png       (optional per project) — falls back to
#                                  github/_default-icon.*
#       metadata.json              (REQUIRED — must include "url")
#
#   metadata/
#       Reserved for future gallery-wide metadata. Not read by this
#       script today — every resource's metadata lives next to it in
#       its own metadata.json instead (see above). This folder is never
#       turned into Gallery content.
#
# metadata.json fields (all optional, include only what's useful):
#   { "title": "...", "description": "...", "date": "...", "url": "..." }
# ("url" is only meaningful for github/ entries.) A missing title
# defaults to a human-readable version of the project's own folder
# name — never a generic label and never the folder-type name.
# ---------------------------------------------------------------------

import json
import sys
import base64
import io
from pathlib import Path
from urllib.parse import quote
from datetime import datetime, timezone

try:
    from PIL import Image
except ImportError:
    print(
        "generate_gallery_manifest.py needs Pillow to resize/convert preview "
        "images.\n\nInstall it with:\n\n    pip install Pillow\n\n"
        "then run this script again.",
        file=sys.stderr,
    )
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent  # Backend/scripts -> Backend -> repo root
RESOURCES_ROOT = REPO_ROOT / "Backend" / "resources" / "infinite gallery"
OUTPUT_PATH = REPO_ROOT / "Frontend" / "js" / "infinite-gallery" / "gallery-manifest.js"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv"}
PDF_EXTS = {".pdf"}
DOC_EXTS = {".doc", ".docx"}
PPT_EXTS = {".ppt", ".pptx"}

PREVIEW_MAX_DIM = 640  # px, longer side — content previews
ICON_MAX_DIM = 320  # px, longer side — pdf/doc/ppt/github icons
WEBP_QUALITY = 80

warnings = []


def warn(msg):
    warnings.append(msg)
    print(f"  ! {msg}")


def find_by_stem(folder, stem):
    """First file in `folder` whose filename (without extension) is exactly `stem`."""
    for f in sorted(folder.iterdir()):
        if f.is_file() and f.stem.lower() == stem.lower():
            return f
    return None


def find_by_ext(folder, exts, exclude=()):
    """First file in `folder` with one of `exts`, skipping anything in `exclude`."""
    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() in exts and f not in exclude:
            return f
    return None


def read_metadata(folder):
    meta_path = folder / "metadata.json"
    if not meta_path.exists():
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            warn(f"{meta_path}: metadata.json must contain a JSON object — ignoring it")
            return {}
        return data
    except (json.JSONDecodeError, OSError) as e:
        warn(f"{meta_path}: could not read metadata.json ({e}) — ignoring it")
        return {}


def prettify_name(name):
    return " ".join(word.capitalize() for word in name.replace("_", " ").replace("-", " ").split())


def encode_relative_url(path_from_repo_root):
    """Turn a repo-root-relative filesystem path into a URL-safe relative
    link from Frontend/infinite-gallery.html (percent-encodes spaces etc.
    in each path segment, e.g. the "infinite gallery" folder name)."""
    parts = path_from_repo_root.parts
    encoded = "/".join(quote(p, safe="") for p in parts)
    return f"../{encoded}"


def make_preview_data_uri(image_path, max_dim):
    """Resize (never upscale) + convert to WebP, return (data_uri, width, height)."""
    with Image.open(image_path) as img:
        img = img.convert("RGBA") if img.mode in ("P", "LA") else img.convert("RGB") if img.mode not in ("RGB", "RGBA") else img
        w, h = img.size
        scale = min(1.0, max_dim / float(max(w, h)))
        if scale < 1.0:
            img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/webp;base64,{b64}", img.width, img.height


def find_default_icon(type_folder):
    return find_by_stem(type_folder, "_default-icon") or find_by_ext(type_folder, IMAGE_EXTS)


def collect_images(type_folder):
    items = []
    if not type_folder.is_dir():
        return items
    for project_dir in sorted(p for p in type_folder.iterdir() if p.is_dir()):
        name = project_dir.name
        meta = read_metadata(project_dir)
        preview_file = find_by_stem(project_dir, "preview") or find_by_ext(project_dir, {".webp"})
        original_file = find_by_stem(project_dir, "original")
        if original_file is None:
            exclude = {preview_file} if preview_file else set()
            original_file = find_by_ext(project_dir, IMAGE_EXTS, exclude=exclude)

        generated_preview = None
        if preview_file is None:
            if original_file is None:
                warn(f"images/{name}: no preview and no image file found — skipping")
                continue
            # Auto-generate a small preview from the original so a single
            # dropped image "just works" without extra manual steps.
            generated_preview = project_dir / "preview.webp"
            try:
                data_uri, w, h = make_preview_data_uri(original_file, PREVIEW_MAX_DIM)
                with Image.open(original_file) as src:
                    src = src.convert("RGB")
                    scale = min(1.0, PREVIEW_MAX_DIM / float(max(src.size)))
                    resized = src.resize(
                        (max(1, round(src.width * scale)), max(1, round(src.height * scale))), Image.LANCZOS
                    ) if scale < 1.0 else src
                    resized.save(generated_preview, format="WEBP", quality=WEBP_QUALITY, method=6)
                print(f"  + images/{name}: generated preview.webp from {original_file.name}")
            except Exception as e:
                warn(f"images/{name}: failed to auto-generate a preview from {original_file.name} ({e}) — skipping")
                continue
        else:
            try:
                data_uri, w, h = make_preview_data_uri(preview_file, PREVIEW_MAX_DIM)
            except Exception as e:
                warn(f"images/{name}: failed to read preview {preview_file.name} ({e}) — skipping")
                continue

        open_target = original_file or preview_file or generated_preview
        open_path = encode_relative_url(
            (Path("Backend") / "resources" / "infinite gallery" / "images" / name / open_target.name)
        )

        items.append({
            "url": data_uri,
            "width": w,
            "height": h,
            "title": meta.get("title") or prettify_name(name),
            "description": meta.get("description"),
            "date": meta.get("date"),
            "type": "image",
            "openPath": open_path,
        })
    return items


def collect_videos(type_folder):
    items = []
    if not type_folder.is_dir():
        return items
    for project_dir in sorted(p for p in type_folder.iterdir() if p.is_dir()):
        name = project_dir.name
        meta = read_metadata(project_dir)
        thumb_file = find_by_stem(project_dir, "thumbnail")
        if thumb_file is None:
            warn(f"videos/{name}: no thumbnail.(webp|jpg|png) found — skipping (this script never auto-generates video thumbnails)")
            continue
        video_file = find_by_stem(project_dir, "video") or find_by_ext(project_dir, VIDEO_EXTS, exclude={thumb_file})
        if video_file is None:
            warn(f"videos/{name}: has a thumbnail but no video file — skipping")
            continue
        try:
            data_uri, w, h = make_preview_data_uri(thumb_file, PREVIEW_MAX_DIM)
        except Exception as e:
            warn(f"videos/{name}: failed to read thumbnail {thumb_file.name} ({e}) — skipping")
            continue

        open_path = encode_relative_url(
            (Path("Backend") / "resources" / "infinite gallery" / "videos" / name / video_file.name)
        )
        items.append({
            "url": data_uri,
            "width": w,
            "height": h,
            "title": meta.get("title") or prettify_name(name),
            "description": meta.get("description"),
            "date": meta.get("date"),
            "type": "video",
            "openPath": open_path,
        })
    return items


def collect_document_like(type_folder, type_name, doc_exts):
    """Shared logic for pdf/ , documents/ , presentations/ — all three
    wait on a representation you'll provide later, so they only differ
    in which file extensions count as "the original"."""
    items = []
    if not type_folder.is_dir():
        return items
    default_icon = find_default_icon(type_folder)
    for project_dir in sorted(p for p in type_folder.iterdir() if p.is_dir()):
        name = project_dir.name
        meta = read_metadata(project_dir)
        preview_file = find_by_stem(project_dir, "preview")
        icon_source = preview_file or default_icon
        if icon_source is None:
            warn(f"{type_name}/{name}: no representation yet (no preview.* here and no {type_name}/_default-icon.*) — skipping until one is supplied")
            continue
        original_file = find_by_ext(project_dir, doc_exts)
        try:
            data_uri, w, h = make_preview_data_uri(icon_source, PREVIEW_MAX_DIM if preview_file else ICON_MAX_DIM)
        except Exception as e:
            warn(f"{type_name}/{name}: failed to read representation {icon_source.name} ({e}) — skipping")
            continue

        open_path = None
        if original_file is not None:
            open_path = encode_relative_url(
                (Path("Backend") / "resources" / "infinite gallery" / type_name / name / original_file.name)
            )
        else:
            warn(f"{type_name}/{name}: representation found but no {type_name} file itself — the item will show but can't be opened")

        items.append({
            "url": data_uri,
            "width": w,
            "height": h,
            "title": meta.get("title") or prettify_name(name),
            "description": meta.get("description"),
            "date": meta.get("date"),
            "type": type_name[:-1] if type_name.endswith("s") and type_name != "pdf" else type_name,
            "openPath": open_path,
        })
    return items


def collect_github(type_folder):
    items = []
    if not type_folder.is_dir():
        return items
    default_icon = find_default_icon(type_folder)
    for project_dir in sorted(p for p in type_folder.iterdir() if p.is_dir()):
        name = project_dir.name
        meta = read_metadata(project_dir)
        url = meta.get("url")
        if not url:
            warn(f"github/{name}: metadata.json has no \"url\" — skipping")
            continue
        icon_file = find_by_stem(project_dir, "icon") or default_icon
        if icon_file is None:
            warn(f"github/{name}: no icon.* here and no github/_default-icon.* — skipping until one is supplied")
            continue
        try:
            data_uri, w, h = make_preview_data_uri(icon_file, ICON_MAX_DIM)
        except Exception as e:
            warn(f"github/{name}: failed to read icon {icon_file.name} ({e}) — skipping")
            continue

        items.append({
            "url": data_uri,
            "width": w,
            "height": h,
            "title": meta.get("title") or prettify_name(name),
            "description": meta.get("description"),
            "date": meta.get("date"),
            "type": "github",
            "link": url,
        })
    return items


def js_string(value):
    if value is None:
        return "undefined"
    return json.dumps(value, ensure_ascii=False)


def render_manifest_js(items):
    lines = []
    lines.append("// ---------------------------------------------------------------------")
    lines.append("// Infinite Gallery — generated resource manifest")
    lines.append("// ---------------------------------------------------------------------")
    lines.append("// AUTO-GENERATED by Backend/scripts/generate_gallery_manifest.py.")
    lines.append("// Do not hand-edit — regenerate instead after changing anything under")
    lines.append('// Backend/resources/infinite gallery/, by running (from the project root):')
    lines.append("//")
    lines.append("//   python Backend/scripts/generate_gallery_manifest.py")
    lines.append("//")
    lines.append(f"// Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"// Resources included: {len(items)}")
    lines.append("//")
    lines.append("// Plain classic script (no import/export), same convention as every")
    lines.append("// other Infinite Gallery file — see constants.js for why.")
    lines.append("(function (global) {")
    lines.append('  "use strict";')
    lines.append("  global.InfiniteGallery = global.InfiniteGallery || {};")
    lines.append("  global.InfiniteGallery.GALLERY_MANIFEST = [")
    for item in items:
        lines.append("    {")
        lines.append(f'      url: {js_string(item["url"])},')
        lines.append(f'      width: {item["width"]},')
        lines.append(f'      height: {item["height"]},')
        lines.append(f'      title: {js_string(item["title"])},')
        lines.append(f'      description: {js_string(item.get("description"))},')
        lines.append(f'      date: {js_string(item.get("date"))},')
        lines.append(f'      type: {js_string(item["type"])},')
        if "link" in item:
            lines.append(f'      link: {js_string(item.get("link"))},')
        else:
            lines.append(f'      openPath: {js_string(item.get("openPath"))},')
        lines.append("    },")
    lines.append("  ];")
    lines.append("})(window);")
    lines.append("")
    return "\n".join(lines)


def main():
    print(f"Scanning: {RESOURCES_ROOT}")
    if not RESOURCES_ROOT.is_dir():
        print(f"ERROR: resource folder not found at {RESOURCES_ROOT}", file=sys.stderr)
        sys.exit(1)

    items = []
    items += collect_images(RESOURCES_ROOT / "images")
    items += collect_videos(RESOURCES_ROOT / "videos")
    items += collect_document_like(RESOURCES_ROOT / "pdf", "pdf", PDF_EXTS)
    items += collect_document_like(RESOURCES_ROOT / "documents", "documents", DOC_EXTS)
    items += collect_document_like(RESOURCES_ROOT / "presentations", "presentations", PPT_EXTS)
    items += collect_github(RESOURCES_ROOT / "github")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(render_manifest_js(items), encoding="utf-8")

    print(f"\nWrote {len(items)} resource(s) to {OUTPUT_PATH}")
    if warnings:
        print(f"({len(warnings)} item(s) skipped — see warnings above)")
    if len(items) == 0:
        print("Gallery will render empty until resources are added — this is expected, not an error.")


if __name__ == "__main__":
    main()
