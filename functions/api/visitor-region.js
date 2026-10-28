// Cloudflare Pages Function — GET /api/visitor-region
//
// Used by Frontend/music-m4.html to choose a starting playlist by Indian state.
// Returns only what Cloudflare already knows about this request from its IP address:
// the country code and the state/region (ISO 3166-2 code and name). No city, no
// coordinates, no IP address, no cookies; nothing is stored or logged here.
// The page treats any failure (404, error, timeout) as "location unavailable" and
// falls back to the Indian playlist.
export function onRequestGet({ request }) {
  const cf = request.cf || {};
  const body = {
    country: cf.country || null,      // e.g. "IN"
    regionCode: cf.regionCode || null, // e.g. "WB" (ISO 3166-2 subdivision, without "IN-")
    region: cf.region || null,         // e.g. "West Bengal"
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
