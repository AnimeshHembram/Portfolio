/* ================================================================
   NIGHT UI PREVIEW — preview-only script
   ----------------------------------------------------------------
   night.html loads this AFTER js/main.js and js/dock.js. Deliberately
   not a copy of any Night UI behavior: the loader fade-in, custom
   cursor, hotspot hover-labels, dock magnification and the night
   hide/reveal state machine all already live in js/main.js and
   js/dock.js, and night.html loads those same files directly — so
   the preview can never silently fall out of sync with the live
   site's actual behavior, because there's nothing duplicated to
   fall out of sync.

   index.html's inline day/night-detection script (in its <head>)
   reads the visitor's clock, decides day vs. night, sets
   data-mode on <html>, and assigns the night photo — all so the
   live site can show the right one automatically. This preview has
   no day UI to switch to, so that entire piece doesn't apply here:
   night.html sets data-mode="night" and the photo's src as plain,
   static HTML instead, which is what makes this preview independent
   of the system clock (there's no clock-reading code left to depend
   on it).

   That's also why this file has nothing left to do at load time —
   it exists as the place for logic that's ONLY meaningful for the
   standalone preview itself (never for the live site), for whenever
   that's needed later.

   Leave real Night UI behavior out of this file. If a Night UI
   behavior needs to change, change it in js/main.js or js/dock.js so
   index.html and night.html both pick it up automatically.
   ================================================================ */
