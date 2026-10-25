# JavaScript Syntax Check

Run the portfolio JavaScript syntax check from the repository root:

```powershell
node scripts/check-js.mjs
```

The script checks tracked JavaScript files under `Frontend/js`,
excluding vendored Three.js files. It reports each file's result
and exits with a non-zero status if a syntax check fails.

Run this check after editing portfolio JavaScript.

# Resume Event Function Tests

Tests for the `/api/resume-event` Cloudflare Pages Function
(`functions/api/resume-event.js`). Uses Node's built-in test runner
only — nothing to install. Run from the repository root:

```powershell
node --test scripts/test-resume-event.mjs
```
