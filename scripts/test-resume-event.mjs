// Tests for functions/api/resume-event.js — no dependencies.
// Run from the repository root:  node --test scripts/test-resume-event.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Loaded as a data: URL so it imports as an ES module on any Node 18+
// version, without needing a package.json "type": "module".
const src = readFileSync(new URL("../functions/api/resume-event.js", import.meta.url), "utf8");
const fn = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const ORIGIN = "https://animesh-portfolio-bci.pages.dev";
const SECRET_KEY = "re_test_SECRET_should_never_leak";
const SECRET_TO = "private-inbox@example.com";

function makeKV({ broken = false } = {}) {
  const store = new Map();
  return {
    store,
    async get(k) {
      if (broken) throw new Error("kv down");
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      if (broken) throw new Error("kv down");
      store.set(k, v);
    },
  };
}

function makeEnv(over = {}) {
  return Object.assign(
    { RESEND_API_KEY: SECRET_KEY, NOTIFY_EMAIL: SECRET_TO, ALLOWED_ORIGIN: ORIGIN, RESUME_EVENTS: makeKV() },
    over
  );
}

function req({ method = "POST", body, origin = ORIGIN, ctype = "application/json", headers = {} } = {}) {
  const h = Object.assign({}, headers);
  if (origin) h.Origin = origin;
  if (ctype) h["Content-Type"] = ctype;
  const init = { method, headers: h };
  if (body !== undefined && method !== "GET" && method !== "HEAD") init.body = body;
  return new Request("https://animesh-portfolio-bci.pages.dev/api/resume-event", init);
}

function okResend(calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
  };
}

// Captures console output so tests can assert nothing secret is logged.
function captureLogs() {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return { lines, restore: () => (console.log = orig) };
}

async function run(request, env, deps = {}) {
  const pending = [];
  const ctx = { request, env, waitUntil: (p) => pending.push(p) };
  const logs = captureLogs();
  let res;
  try {
    res = await fn.handle(ctx, Object.assign({ now: () => new Date("2026-10-25T08:30:00Z"), uuid: () => "evt-1" }, deps));
    await Promise.all(pending);
  } finally {
    logs.restore();
  }
  const text = await res.text();
  return { res, text, logs: logs.lines };
}

function assertNoLeak({ text, logs, res }) {
  const all = text + "\n" + logs.join("\n") + "\n" + JSON.stringify([...res.headers]);
  assert.ok(!all.includes(SECRET_KEY), "API key leaked");
  assert.ok(!all.includes(SECRET_TO), "recipient leaked");
}

test("valid download event → 202, Resend called with correct email", async () => {
  const calls = [];
  const r = await run(req({ body: JSON.stringify({ type: "download", page: "/index.html" }) }), makeEnv(), { fetch: okResend(calls) });
  assert.equal(r.res.status, 202);
  assert.deepEqual(JSON.parse(r.text), { ok: true });
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(sent.subject, "Portfolio Alert — Resume Download Requested");
  assert.deepEqual(sent.to, [SECRET_TO]);
  assert.match(sent.text, /Resume download initiated/);
  assert.match(sent.text, /Time \(UTC\): 2026-10-25T08:30:00.000Z/);
  assert.match(sent.text, /Page: \/ \(home\)/);
  assert.match(sent.text, /Event ID: evt-1/);
  assert.match(sent.text, /does not prove the PDF was saved, opened, or read/);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "resume-event-evt-1");
  assert.ok(r.logs.some((l) => l.includes('"outcome":"sent"') && l.includes("email_123")));
  assertNoLeak(r);
});

test("valid view event → distinct subject and wording", async () => {
  const calls = [];
  const r = await run(req({ body: JSON.stringify({ type: "view", page: "/night" }) }), makeEnv(), { fetch: okResend(calls) });
  assert.equal(r.res.status, 202);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.subject, "Portfolio Alert — Resume View Requested");
  assert.match(sent.text, /Resume view requested/);
  assert.match(sent.text, /Page: \/night.html/);
  assert.doesNotMatch(sent.text, /download initiated/);
  assertNoLeak(r);
});

test("invalid event type → 400, no email", async () => {
  const calls = [];
  for (const type of ["open", "VIEW", "", 1, null]) {
    const r = await run(req({ body: JSON.stringify({ type, page: "/" }) }), makeEnv(), { fetch: okResend(calls) });
    assert.equal(r.res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("invalid JSON, extra fields, non-object → 400", async () => {
  const calls = [];
  for (const body of ["{not json", "[]", '"view"', JSON.stringify({ type: "view", page: "/", to: "x@y.z" }), ""]) {
    const r = await run(req({ body }), makeEnv(), { fetch: okResend(calls) });
    assert.equal(r.res.status, 400, body);
  }
  assert.equal(calls.length, 0);
});

test("oversized request → 413 (declared and streamed)", async () => {
  const calls = [];
  const big = JSON.stringify({ type: "view", page: "/", pad: "x".repeat(5000) });
  const r1 = await run(req({ body: big }), makeEnv(), { fetch: okResend(calls) });
  assert.equal(r1.res.status, 413);
  // Streamed body without a Content-Length header
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(big));
      c.close();
    },
  });
  const r2 = await run(
    new Request("https://x/api/resume-event", { method: "POST", body: stream, duplex: "half", headers: { Origin: ORIGIN, "Content-Type": "application/json" } }),
    makeEnv(),
    { fetch: okResend(calls) }
  );
  assert.equal(r2.res.status, 413);
  assert.equal(calls.length, 0);
});

test("unsupported HTTP methods → 405 with Allow: POST", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const r = await run(req({ method, body: method === "GET" ? undefined : "{}" }), makeEnv());
    assert.equal(r.res.status, 405, method);
    assert.equal(r.res.headers.get("Allow"), "POST");
  }
});

test("untrusted / missing origin or cross-site fetch → 403", async () => {
  const calls = [];
  const body = JSON.stringify({ type: "view", page: "/" });
  const cases = [
    req({ body, origin: "https://evil.example" }),
    req({ body, origin: "https://animesh-portfolio-bci.pages.dev.evil.example" }),
    req({ body, origin: null }),
    req({ body, headers: { "Sec-Fetch-Site": "cross-site" } }),
  ];
  for (const c of cases) {
    const r = await run(c, makeEnv(), { fetch: okResend(calls) });
    assert.equal(r.res.status, 403);
  }
  // No ALLOWED_ORIGIN configured → everything is rejected
  const r = await run(req({ body }), makeEnv({ ALLOWED_ORIGIN: undefined }), { fetch: okResend(calls) });
  assert.equal(r.res.status, 403);
  assert.equal(calls.length, 0);
});

test("wrong content type → 415", async () => {
  for (const ctype of ["text/plain", "application/x-www-form-urlencoded", null]) {
    const r = await run(req({ body: JSON.stringify({ type: "view", page: "/" }), ctype }), makeEnv());
    assert.equal(r.res.status, 415);
  }
});

test("invalid page path → 400", async () => {
  const calls = [];
  for (const page of ["/ab2.html", "https://evil.example/", "/index.html?x=1", "../../etc", "/" + "a".repeat(100), 5]) {
    const r = await run(req({ body: JSON.stringify({ type: "view", page }) }), makeEnv(), { fetch: okResend(calls) });
    assert.equal(r.res.status, 400, String(page));
  }
  assert.equal(calls.length, 0);
});

test("missing Resend configuration → visitor still gets 202, no send, logged", async () => {
  const calls = [];
  for (const over of [{ RESEND_API_KEY: undefined }, { NOTIFY_EMAIL: "" }]) {
    const r = await run(req({ body: JSON.stringify({ type: "download", page: "/" }) }), makeEnv(over), { fetch: okResend(calls) });
    assert.equal(r.res.status, 202);
    assert.ok(r.logs.some((l) => l.includes("config_missing")));
    assertNoLeak(r);
  }
  assert.equal(calls.length, 0);
});

test("Resend rejection → 202 to visitor, logged as provider_rejected, never 'sent'", async () => {
  const r = await run(req({ body: JSON.stringify({ type: "download", page: "/" }) }), makeEnv(), {
    fetch: async () => new Response(JSON.stringify({ message: "invalid key for " + SECRET_TO }), { status: 403 }),
  });
  assert.equal(r.res.status, 202);
  assert.ok(r.logs.some((l) => l.includes('"outcome":"provider_rejected"') && l.includes('"status":403')));
  assert.ok(!r.logs.some((l) => l.includes('"outcome":"sent"')));
  assertNoLeak(r); // provider response bodies are never logged
});

test("Resend OK without a message id → provider_unconfirmed, not 'sent'", async () => {
  const r = await run(req({ body: JSON.stringify({ type: "view", page: "/" }) }), makeEnv(), {
    fetch: async () => new Response("{}", { status: 200 }),
  });
  assert.ok(r.logs.some((l) => l.includes("provider_unconfirmed")));
});

test("Resend timeout → aborted after limit, logged as provider_timeout", async () => {
  const orig = fn.LIMITS.resendTimeoutMs;
  fn.LIMITS.resendTimeoutMs = 50;
  try {
    const r = await run(req({ body: JSON.stringify({ type: "download", page: "/" }) }), makeEnv(), {
      fetch: (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    });
    assert.equal(r.res.status, 202);
    assert.ok(r.logs.some((l) => l.includes("provider_timeout")));
  } finally {
    fn.LIMITS.resendTimeoutMs = orig;
  }
});

test("network failure to Resend → provider_unreachable", async () => {
  const r = await run(req({ body: JSON.stringify({ type: "view", page: "/" }) }), makeEnv(), {
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.ok(r.logs.some((l) => l.includes("provider_unreachable")));
});

test("missing or broken KV binding → fail closed (no email), visitor gets 202", async () => {
  const calls = [];
  const r1 = await run(req({ body: JSON.stringify({ type: "view", page: "/" }) }), makeEnv({ RESUME_EVENTS: undefined }), { fetch: okResend(calls) });
  assert.equal(r1.res.status, 202);
  assert.ok(r1.logs.some((l) => l.includes("kv_unavailable")));
  const r2 = await run(req({ body: JSON.stringify({ type: "view", page: "/" }) }), makeEnv({ RESUME_EVENTS: makeKV({ broken: true }) }), { fetch: okResend(calls) });
  assert.equal(r2.res.status, 202);
  assert.ok(r2.logs.some((l) => l.includes("kv_error")));
  assert.equal(calls.length, 0);
});

test("dedupe: same event type within 60s sends once; other type still sends", async () => {
  const calls = [];
  const env = makeEnv();
  const body = (t) => JSON.stringify({ type: t, page: "/" });
  await run(req({ body: body("download") }), env, { fetch: okResend(calls) });
  const r = await run(req({ body: body("download") }), env, { fetch: okResend(calls) });
  assert.ok(r.logs.some((l) => l.includes('"outcome":"deduped"')));
  await run(req({ body: body("view") }), env, { fetch: okResend(calls) });
  assert.equal(calls.length, 2);
  // dedupe key is written with a TTL so it expires on its own
  assert.equal(env.RESUME_EVENTS.store.get("dedupe:download"), "1");
});

test("rate limit: 10 per hour, 40 per day", async () => {
  const calls = [];
  const env = makeEnv();
  // Clear the dedupe key between sends to isolate the hourly/daily caps.
  const send = (t, now) => {
    env.RESUME_EVENTS.store.delete("dedupe:view");
    env.RESUME_EVENTS.store.delete("dedupe:download");
    return run(req({ body: JSON.stringify({ type: t, page: "/" }) }), env, { fetch: okResend(calls), now: () => now });
  };
  const h = new Date("2026-10-25T08:00:00Z");
  for (let i = 0; i < 12; i++) await send(i % 2 ? "view" : "download", h);
  assert.equal(calls.length, 10, "hourly cap");
  // Spread across later hours until the daily cap is hit
  for (let hr = 9; hr < 14; hr++) {
    for (let i = 0; i < 10; i++) await send("view", new Date(`2026-10-25T${String(hr).padStart(2, "0")}:00:00Z`));
  }
  assert.equal(calls.length, 40, "daily cap");
  // Next UTC day resets
  await send("view", new Date("2026-10-26T00:10:00Z"));
  assert.equal(calls.length, 41);
});

test("responses are neutral and identical for every accepted outcome", async () => {
  const bodies = new Set();
  const outcomes = [
    makeEnv(),
    makeEnv({ RESEND_API_KEY: undefined }),
    makeEnv({ RESUME_EVENTS: undefined }),
  ];
  for (const env of outcomes) {
    const r = await run(req({ body: JSON.stringify({ type: "view", page: "/" }) }), env, { fetch: okResend([]) });
    bodies.add(r.res.status + " " + r.text);
    assert.equal(r.res.headers.get("Cache-Control"), "no-store");
  }
  assert.deepEqual([...bodies], ['202 {"ok":true}']);
});
