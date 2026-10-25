// Cloudflare Pages Function — POST /api/resume-event
//
// Receives a "someone clicked View/Download Resume" event from the
// portfolio's dock (Frontend/js/dock.js) and, within rate limits, asks
// Resend to email a notification to the site owner.
//
// Configuration (Cloudflare Pages → Settings; never in source control):
//   RESEND_API_KEY  secret — Resend API key with "Sending access" only
//   NOTIFY_EMAIL    secret — recipient; must be the Resend account's own
//                   address while sending from onboarding@resend.dev
//   ALLOWED_ORIGIN  variable — comma-separated list of exact origins
//                   allowed to post events, e.g.
//                   https://animesh-portfolio-bci.pages.dev
//   RESUME_EVENTS   KV namespace binding — rate limiting / dedup counters
//
// Privacy: stores and sends only the event type, the page path, a UTC
// timestamp and a random event ID. No IP addresses, user agents, cookies
// or other visitor identifiers are read, stored, logged or emailed.
//
// The visitor always gets a neutral response; whether an email was
// actually accepted by Resend is only recorded in the Function's logs.

export const LIMITS = {
  maxBodyBytes: 1024,
  perHour: 10,
  perDay: 40,
  dedupeSeconds: 60, // KV's minimum TTL — same event type within this window is skipped
  resendTimeoutMs: 5000,
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "Portfolio Alerts <onboarding@resend.dev>";

const EVENTS = {
  view: {
    subject: "Portfolio Alert — Resume View Requested",
    label: "Resume view requested (View Resume clicked)",
    note:
      "This confirms that someone clicked View Resume. It does not prove the PDF was opened or read.",
  },
  download: {
    subject: "Portfolio Alert — Resume Download Requested",
    label: "Resume download initiated (Download Resume clicked)",
    note:
      "This confirms that someone clicked Download Resume. It does not prove the PDF was saved, opened, or read.",
  },
};

// Pages the dock lives on. Cloudflare Pages serves /day.html at /day as
// well, so both spellings map to one canonical label.
const PAGES = {
  "/": "/ (home)",
  "/index": "/ (home)",
  "/index.html": "/ (home)",
  "/day": "/day.html",
  "/day.html": "/day.html",
  "/night": "/night.html",
  "/night.html": "/night.html",
};

const NEUTRAL_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function reply(status, extraHeaders) {
  return new Response(JSON.stringify({ ok: status < 300 }), {
    status,
    headers: Object.assign({}, NEUTRAL_HEADERS, extraHeaders || {}),
  });
}

function log(fields) {
  // Structured, secret-free log line (visible in Pages real-time logs).
  console.log(JSON.stringify(Object.assign({ fn: "resume-event" }, fields)));
}

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGIN) || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

// Reads at most `limit` bytes; returns null if the body is larger.
async function readLimited(request, limit) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      try {
        await reader.cancel();
      } catch (_) {
        /* ignore */
      }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

// Returns { type, page } or null.
export function parseEvent(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.some((k) => k !== "type" && k !== "page")) return null;
  if (typeof data.type !== "string" || !Object.prototype.hasOwnProperty.call(EVENTS, data.type)) {
    return null;
  }
  if (typeof data.page !== "string" || data.page.length > 64) return null;
  if (!Object.prototype.hasOwnProperty.call(PAGES, data.page)) return null;
  return { type: data.type, page: PAGES[data.page] };
}

function utcKeys(now) {
  const iso = now.toISOString(); // 2026-10-25T08:30:00.000Z
  return { hour: "count:hour:" + iso.slice(0, 13), day: "count:day:" + iso.slice(0, 10) };
}

// Approximate limiter: KV is eventually consistent, so concurrent
// requests in different locations can briefly see stale counts.
// Returns "ok" | "deduped" | "rate_limited". Throws if KV fails.
export async function checkAndReserve(kv, type, now) {
  const keys = utcKeys(now);
  const dedupeKey = "dedupe:" + type;
  const [hourRaw, dayRaw, recent] = await Promise.all([
    kv.get(keys.hour),
    kv.get(keys.day),
    kv.get(dedupeKey),
  ]);
  if (recent) return "deduped";
  const hour = parseInt(hourRaw, 10) || 0;
  const day = parseInt(dayRaw, 10) || 0;
  if (hour >= LIMITS.perHour || day >= LIMITS.perDay) return "rate_limited";
  // Reserve before sending, so a failed send still counts toward the
  // limit (fail towards fewer emails, never more).
  await Promise.all([
    kv.put(keys.hour, String(hour + 1), { expirationTtl: 2 * 60 * 60 }),
    kv.put(keys.day, String(day + 1), { expirationTtl: 2 * 24 * 60 * 60 }),
    kv.put(dedupeKey, "1", { expirationTtl: LIMITS.dedupeSeconds }),
  ]);
  return "ok";
}

export function buildEmail(event, page, eventId, timestamp) {
  const meta = EVENTS[event];
  const text = [
    "Portfolio Alert",
    "",
    "Event: " + meta.label,
    "Time (UTC): " + timestamp,
    "Page: " + page,
    "Event ID: " + eventId,
    "",
    "Note: " + meta.note,
    "Notifications are best-effort and rate-limited; some clicks will not produce an email.",
  ].join("\n");
  return { subject: meta.subject, text };
}

async function sendViaResend(env, email, eventId, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.resendTimeoutMs);
  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "resume-event-" + eventId,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [env.NOTIFY_EMAIL],
        subject: email.subject,
        text: email.text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { outcome: "provider_rejected", status: res.status };
    let id = null;
    try {
      const data = await res.json();
      id = data && typeof data.id === "string" ? data.id : null;
    } catch (_) {
      /* fall through */
    }
    // Only an OK response carrying a message id counts as accepted.
    return id ? { outcome: "sent", status: res.status, providerId: id } : { outcome: "provider_unconfirmed", status: res.status };
  } catch (err) {
    return { outcome: err && err.name === "AbortError" ? "provider_timeout" : "provider_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function notify(env, event, page, deps) {
  const now = deps.now();
  const eventId = deps.uuid();
  const base = { event_id: eventId, type: event };

  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) {
    log(Object.assign(base, { outcome: "config_missing" }));
    return "config_missing";
  }
  if (!env.RESUME_EVENTS || typeof env.RESUME_EVENTS.get !== "function") {
    // Fail closed: without the limiter, don't send at all.
    log(Object.assign(base, { outcome: "kv_unavailable" }));
    return "kv_unavailable";
  }

  let gate;
  try {
    gate = await checkAndReserve(env.RESUME_EVENTS, event, now);
  } catch (_) {
    log(Object.assign(base, { outcome: "kv_error" }));
    return "kv_error";
  }
  if (gate !== "ok") {
    log(Object.assign(base, { outcome: gate }));
    return gate;
  }

  const email = buildEmail(event, page, eventId, now.toISOString());
  const result = await sendViaResend(env, email, eventId, deps.fetch);
  log(Object.assign(base, result));
  return result.outcome;
}

export async function handle(context, deps) {
  const { request, env } = context;
  deps = Object.assign(
    { fetch: (...a) => fetch(...a), now: () => new Date(), uuid: () => crypto.randomUUID() },
    deps || {}
  );

  if (request.method !== "POST") return reply(405, { Allow: "POST" });

  const origins = allowedOrigins(env);
  const origin = request.headers.get("Origin");
  if (!origin || !origins.includes(origin)) return reply(403);
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return reply(403);

  const ctype = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (ctype !== "application/json") return reply(415);

  const declared = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (declared > LIMITS.maxBodyBytes) return reply(413);

  let text;
  try {
    text = await readLimited(request, LIMITS.maxBodyBytes);
  } catch (_) {
    return reply(400);
  }
  if (text === null) return reply(413);

  const parsed = parseEvent(text);
  if (!parsed) return reply(400);

  // Respond immediately; the notification attempt continues in the
  // background and never delays or affects the visitor.
  const work = notify(env, parsed.type, parsed.page, deps).catch(() => {
    log({ outcome: "internal_error" });
  });
  if (typeof context.waitUntil === "function") context.waitUntil(work);
  else await work;

  return reply(202);
}

export function onRequest(context) {
  return handle(context);
}
