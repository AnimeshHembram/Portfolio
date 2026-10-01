/* ================================================================
   DAY UI PREVIEW — preview-only script
   ----------------------------------------------------------------
   day.html loads this AFTER js/main.js, js/day-background.js and
   js/dock.js. Deliberately not a copy of any Day UI behavior: the
   loader fade-in, custom cursor, WebGL shader background and dock
   magnification all already live in js/main.js, js/day-background.js
   and js/dock.js, and day.html loads those same files directly — so
   the preview can never silently fall out of sync with the live
   site's actual behavior, because there's nothing duplicated to fall
   out of sync.

   index.html's inline day/night-detection script (in its <head>)
   reads the visitor's clock, decides day vs. night, and sets
   data-mode on <html> so the right desktop shows. This preview has
   no night UI to switch to, so that entire piece doesn't apply here:
   day.html sets data-mode="day" as plain, static HTML instead, which
   is what makes this preview independent of the system clock —
   there's no clock-reading code left to depend on it.

   That's also why this file has nothing left to do at load time —
   it exists as the place for logic that's ONLY meaningful for the
   standalone preview itself (never for the live site), for whenever
   that's needed later.

   Leave real Day UI behavior out of this file. If a Day UI behavior
   needs to change, change it in js/main.js, js/day-background.js or
   js/dock.js so index.html and day.html both pick it up
   automatically.
   ================================================================ */
