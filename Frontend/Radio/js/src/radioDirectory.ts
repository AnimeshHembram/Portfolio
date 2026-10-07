export interface RadioCountry {
  name: string;
  iso_3166_1: string;
  stationcount: number | string;
}

export interface RadioStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  city?: string | null;
  frequency?: number | string | null;
  frequency_mhz?: number | string | null;
  lastcheckok?: number | boolean;
  clickcount?: number;
  codec?: string;
  bitrate?: number;
  hls?: number;
  ssl_error?: number | string;
  geo_lat?: number | null;
  geo_long?: number | null;
}

export interface RadioLocation {
  label: string;
  stations: RadioStation[];
}

export interface RadioState {
  name: string;
  country?: string;
  stationcount: number | string;
}

export interface RadioCity {
  label: string;
  // Every spelling the directory uses for this place; station lookups query each one exactly.
  names: string[];
}

const DEFAULT_BASES = ["https://de1.api.radio-browser.info"];
const configuredBases = (import.meta.env.VITE_RADIO_BROWSER_BASES ?? "")
  .split(",")
  .map((base: string) => base.trim().replace(/\/+$/, ""))
  .filter((base: string) => /^https:\/\//i.test(base));
const apiBases = configuredBases.length > 0 ? configuredBases : DEFAULT_BASES;
let lastSuccessfulBase = 0;

function buildQuery(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

async function fetchFromDirectory<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < apiBases.length; attempt += 1) {
    const baseIndex = (lastSuccessfulBase + attempt) % apiBases.length;
    const base = apiBases[baseIndex];
    try {
      const response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(`Radio directory returned ${response.status}`);
      lastSuccessfulBase = baseIndex;
      return (await response.json()) as T;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("The radio station directory is unavailable.");
}

function normalizedLocation(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function stationLocation(station: RadioStation) {
  // Radio Browser's public station records are inconsistent: use city when present,
  // otherwise expose its state/area label as-is instead of inventing a city.
  return (station.city?.trim() || station.state?.trim() || "").replace(/\s+/g, " ");
}

export function groupStationsByLocation(stations: RadioStation[]): RadioLocation[] {
  const groups = new Map<string, RadioStation[]>();
  for (const station of stations) {
    const label = stationLocation(station);
    const key = normalizedLocation(label);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(station);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, groupedStations]) => ({
      label: groupedStations[0] ? stationLocation(groupedStations[0]) : key,
      stations: groupedStations,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// City / area list
//
// Radio Browser has no city field. What the CITY list shows comes from `state`, a free-text
// label typed by whoever registered each station, so the same place arrives in several
// spellings ("Tamil Nadu", "Tamilnadu"), with typing mistakes ("Maharastra"), with a region
// attached ("Giridih , Jharkhand"), as two places in one ("Kolkata Mumbai"), or as no place at
// all ("National"). The labels are cleaned up here before they reach the list.
//
// A label may be a city or a larger area (a state, a province): the directory files most
// stations under one or the other, and nothing in its data says which is which, so both stay.
//
// Every entry keeps the exact labels the directory uses for it (`names`). Station lookups ask
// for those, so tidying what is shown never changes which stations are found.

// Words that are not capitalised inside a name ("Jammu and Kashmir", "Rio de Janeiro").
const LOWERCASE_NAME_WORDS = new Set([
  "and", "of", "the", "de", "del", "la", "le", "les", "du", "da", "do", "dos", "das", "di",
  "van", "von", "der", "den", "am", "an", "im", "in", "on", "upon", "sur", "y", "e", "et", "und", "zu",
]);
// Labels that describe coverage or say nothing, in place of a location.
const NOT_A_PLACE = new Set([
  "national", "nationwide", "countrywide", "international", "worldwide", "world", "global", "everywhere",
  "online", "internet", "web", "webradio", "digital", "radio", "fm", "unknown", "undefined", "none", "null",
  "nil", "na", "other", "others", "all", "pan", "various", "misc", "general", "test", "country", "state",
  "city", "region", "province", "notavailable", "notspecified", "nacional", "nazionale", "nationale",
  "internacional", "bundesweit", "landesweit", "landelijk", "weltweit", "mundial",
]);
// What is left of "Northern Ireland" without the country's name is not a place.
const NOT_A_NAME_ALONE = new Set([
  "north", "south", "east", "west", "northern", "southern", "eastern", "western", "central", "upper", "lower",
  "new", "old", "great", "greater", "saint", "san", "santa", "the",
]);
// Words that join two places in one label ("Kolkata and Mumbai").
const JOINING_WORDS = new Set(["and", "und", "y", "e", "et"]);
const LABEL_SEPARATOR = /\s*[,;/|，、]\s*|\s+[-–—]\s+/u;
const LABEL_MAX_LENGTH = 60;
const HAS_NUMBER = /\p{N}/u;
// A label named after the country itself is kept only when a real share of the country's
// stations use it (Luxembourg, Singapore); otherwise it says nothing about where ("India").
const COUNTRY_NAMED_LABEL_MIN_SHARE = 0.2;

function tidyLabel(value: string): string {
  let text = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
  text = text.replace(/^["'.,;:|/\\\-–—_*#~\s]+/u, "").replace(/["',;:|/\\\-–—_*#~\s]+$/u, "");
  // A full stop at the end is dropped unless it closes an abbreviation ("D.C.").
  if (text.endsWith(".") && !/\.[^\s.]*\.$/.test(text)) text = text.slice(0, -1).trimEnd();
  // A bracket without its partner is a typing slip; a complete pair is part of the name ("Frankfurt (Oder)").
  if (!text.includes(")")) text = text.replace(/\(/g, " ");
  if (!text.includes("(")) text = text.replace(/\)/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

// The form in which two labels count as the same: no case, accents, spaces or punctuation.
function labelKey(value: string): string {
  return value
    .normalize("NFKD") // separates accents from their letters; they are removed with the punctuation below
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst\b\.?/g, "saint")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function labelTokens(value: string): string[] {
  return value.split(/[\s\-–—]+/u).map(labelKey).filter(Boolean);
}

function capitalised(word: string): string {
  return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
}

// Labels typed entirely in lower or upper case are shown as names ("chennai" → "Chennai",
// "KERALA" → "Kerala"); anything already in mixed case is left as it was typed.
function presentableLabel(label: string): string {
  const letters = label.replace(/[^\p{L}]+/gu, "");
  const allLower = letters === letters.toLocaleLowerCase();
  const allUpper = letters === letters.toLocaleUpperCase();
  if (allUpper && !allLower && letters.length <= 3) return label; // an abbreviation: "NRW", "DC"
  if (allLower || allUpper) {
    return label
      .split(" ")
      .map((word, index) =>
        index > 0 && LOWERCASE_NAME_WORDS.has(word.toLocaleLowerCase())
          ? word.toLocaleLowerCase()
          : word.split("-").map(capitalised).join("-"),
      )
      .join(" ");
  }
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}

// How many single-letter edits (insert, delete, replace, swap two neighbours) separate two
// keys, counted up to `limit` (1 or 2); anything further apart reports limit + 1.
function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  // What the two have in common at the start and at the end does not count.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const restA = endA - start;
  const restB = endB - start;
  if (restA + restB === 1 || (restA === 1 && restB === 1)) return 1;
  if (restA === 2 && restB === 2 && a[start] === b[start + 1] && a[start + 1] === b[start]) return 1;
  if (limit < 2) return limit + 1;
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);

  let beforePrevious: number[] = [];
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    let best = i;
    for (let k = 1; k <= y.length; k += 1) {
      const cost = x[i - 1] === y[k - 1] ? 0 : 1;
      let value = Math.min(previous[k] + 1, current[k - 1] + 1, previous[k - 1] + cost);
      if (i > 1 && k > 1 && x[i - 1] === y[k - 2] && x[i - 2] === y[k - 1]) value = Math.min(value, beforePrevious[k - 2] + 1);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    beforePrevious = previous;
    previous = current;
  }
  return Math.min(previous[y.length], limit + 1);
}

// True when the lighter label is, in all likelihood, a typing mistake for the heavier one:
// the same first letter and one letter off (two for long names). Short names and names with
// several stations of their own are only merged into a clearly more common spelling, because
// two real places can also be one letter apart (Bolton and Boston).
interface Spelling {
  key: string;
  weight: number;
  // Names with a number in them are never merged ("District 8" is not "District 9").
  numbered: boolean;
  // Which letters occur in the key, one bit each: a quick way to rule out most pairs.
  letters: number;
}

function letterSet(key: string): number {
  let bits = 0;
  for (let index = 0; index < key.length; index += 1) bits |= 1 << (key.charCodeAt(index) % 31);
  return bits;
}

function bitCount(value: number): number {
  let bits = value - ((value >>> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function isMisspellingOf(lighter: Spelling, heavier: Spelling): boolean {
  const a = lighter.key;
  const b = heavier.key;
  const shortest = Math.min(a.length, b.length);
  if (lighter.numbered || heavier.numbered || a[0] !== b[0] || shortest < 5 || Math.abs(a.length - b.length) > 2) return false;
  const clearlyRarer = heavier.weight >= 3 * lighter.weight;
  if (!clearlyRarer && !(shortest >= 8 && lighter.weight <= 2)) return false;
  const allowed = shortest >= 10 && clearlyRarer ? 2 : 1;
  // One edit changes at most two letters of the set (one out, one in).
  if (bitCount(lighter.letters ^ heavier.letters) > 2 * allowed) return false;
  return editDistance(a, b, allowed) <= allowed;
}

interface CountryIdentity {
  name?: string;
  code?: string;
}

interface CityGroup extends Spelling {
  tokens: string[];
  // The spellings of this very name (not of merged misspellings), with their station counts.
  spellings: Map<string, number>;
  // The directory's own labels that belong here, in the order they arrived.
  names: string[];
  // The country's name had to be removed from the label ("Tamil India").
  shortened: boolean;
  // Shown with its region because another city has the same name; never merged with anything.
  withRegion: boolean;
}

function countryNameTokens(country: CountryIdentity): string[][] {
  const names = new Set<string>();
  if (country.name) {
    names.add(country.name);
    names.add(country.name.replace(/^the\s+/i, ""));
  }
  if (country.code && /^[A-Za-z]{2}$/.test(country.code.trim())) {
    try {
      const english = new Intl.DisplayNames(["en"], { type: "region" }).of(country.code.trim().toUpperCase());
      if (english) names.add(english);
    } catch {
      // No such list in this browser: the directory's own name for the country is enough.
    }
  }
  return [...names].map(labelTokens).filter((tokens) => tokens.length > 0);
}

function buildCities(entries: Array<{ name: string | null | undefined; weight: number }>, country: CountryIdentity = {}): RadioCity[] {
  const countryNames = countryNameTokens(country);
  const countryKeys = new Set(countryNames.map((tokens) => tokens.join("")));
  const countryCode = country.code?.trim().toLowerCase();
  const isCountry = (key: string) => countryKeys.has(key) || (countryCode !== undefined && key === countryCode);
  const totalWeight = entries.reduce((sum, entry) => sum + (entry.weight > 0 ? entry.weight : 0), 0);

  // 1. Clean every label: find the place it names and, for "City, Region", the region.
  interface Row {
    name: string;
    weight: number;
    place: string;
    key: string;
    region: string;
    shortened: boolean;
  }
  const rows: Row[] = [];
  for (const { name, weight } of entries) {
    if (typeof name !== "string" || !name.trim() || name.length > 4 * LABEL_MAX_LENGTH) continue;
    if (/:\/\/|www\.|@|\.(com|net|org|info|fm)\b/i.test(name) || NOT_A_PLACE.has(labelKey(name))) continue;

    let place = "";
    let region = "";
    let shortened = false;
    for (const part of name.split(LABEL_SEPARATOR)) {
      let candidate = tidyLabel(part);
      let key = labelKey(candidate);
      // A place name has at least two letters.
      if (!/\p{L}.*\p{L}/u.test(candidate) || candidate.length > LABEL_MAX_LENGTH || NOT_A_PLACE.has(key)) continue;
      if (isCountry(key)) {
        // Only a label that is nothing but the country's name can stand for a place of that name.
        if (labelKey(name) === key && totalWeight > 0 && weight / totalWeight >= COUNTRY_NAMED_LABEL_MIN_SHARE) place = candidate;
        continue;
      }
      // "Tamil India" → "Tamil": the country's name at either end says nothing about where.
      let cut = false;
      const tokens = labelTokens(candidate);
      const words = candidate.split(/\s+/);
      for (const countryTokens of countryNames) {
        const n = countryTokens.length;
        if (words.length <= n || tokens.length !== words.length) continue;
        const atEnd = countryTokens.every((token, index) => tokens[tokens.length - n + index] === token);
        const atStart = !atEnd && countryTokens.every((token, index) => tokens[index] === token);
        if (!atEnd && !atStart) continue;
        const rest = tidyLabel((atEnd ? words.slice(0, -n) : words.slice(n)).join(" "));
        const restKey = labelKey(rest);
        if (!restKey || NOT_A_NAME_ALONE.has(restKey)) break;
        candidate = rest;
        key = restKey;
        cut = true;
        break;
      }
      if (NOT_A_PLACE.has(key) || isCountry(key)) continue;
      // The first part that names a place is the place; the next one is its region.
      if (!place) {
        place = candidate;
        shortened = cut;
      } else {
        region = candidate;
        break;
      }
    }
    if (place) rows.push({ name, weight, place, key: labelKey(place), region, shortened });
  }

  // The same city name with different regions is two cities ("Portland, Maine" and "Portland,
  // Oregon"): those keep their region. A single region adds nothing and is left out
  // ("Giridih , Jharkhand" → "Giridih").
  const regionsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.region) continue;
    regionsOf.set(row.key, (regionsOf.get(row.key) ?? new Set()).add(labelKey(row.region)));
  }

  // Group the labels that are the same name.
  const groups = new Map<string, CityGroup>();
  for (const row of rows) {
    const distinct = row.region !== "" && (regionsOf.get(row.key)?.size ?? 0) > 1;
    const place = distinct ? `${row.place}, ${row.region}` : row.place;
    const key = distinct ? `${row.key},${labelKey(row.region)}` : row.key;
    const group: CityGroup = groups.get(key) ?? {
      key,
      tokens: labelTokens(row.place),
      weight: 0,
      numbered: HAS_NUMBER.test(key),
      letters: letterSet(key),
      spellings: new Map(),
      names: [],
      shortened: true,
      withRegion: distinct,
    };
    group.weight += row.weight;
    group.spellings.set(place, (group.spellings.get(place) ?? 0) + row.weight);
    if (!group.names.includes(row.name)) group.names.push(row.name);
    if (!row.shortened) group.shortened = false;
    groups.set(key, group);
  }

  // 2. A label made of nothing but other labels ("Kolkata Mumbai") is two places in one: its
  //    stations are filed under each of them and it gets no entry of its own. A name that is
  //    more common than its parts is a place in its own right ("Jammu and Kashmir").
  for (const group of [...groups.values()]) {
    if (group.tokens.length < 2 || group.withRegion) continue;
    const parts = placesWithin(group, groups);
    if (!parts || parts.some((part) => part.weight < group.weight)) continue;
    for (const part of parts) {
      for (const name of group.names) if (!part.names.includes(name)) part.names.push(name);
    }
    groups.delete(group.key);
  }

  // 3. Misspellings join the more common spelling; a label cut short by removing the country
  //    name joins the one name it begins ("Tamil" → "Tamil Nadu").
  const ranked = [...groups.values()].sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const kept: CityGroup[] = [];
  // Kept names by first letter and length, so each name is only compared with the few it could be a misspelling of.
  const keptAlike = new Map<string, CityGroup[]>();
  for (const group of ranked) {
    let target: CityGroup | undefined;
    for (let length = group.key.length - 2; length <= group.key.length + 2 && !target && !group.withRegion; length += 1) {
      target = keptAlike.get(`${group.key[0]}${length}`)?.find((candidate) => isMisspellingOf(group, candidate));
    }
    if (!target && group.shortened && group.key.length >= 4) {
      const longer = kept.filter((other) => !other.withRegion && other.key.length > group.key.length + 1 && other.key.startsWith(group.key));
      if (longer.length === 1) target = longer[0];
    }
    if (!target) {
      kept.push(group);
      if (group.withRegion) continue;
      const alike = `${group.key[0]}${group.key.length}`;
      const bucket = keptAlike.get(alike);
      if (bucket) bucket.push(group);
      else keptAlike.set(alike, [group]);
      continue;
    }
    target.weight += group.weight;
    for (const name of group.names) if (!target.names.includes(name)) target.names.push(name);
  }

  // 4. Show each place under its most used spelling, properly capitalised.
  const isMixedCase = (text: string) => text !== text.toLocaleLowerCase() && text !== text.toLocaleUpperCase();
  return kept
    .map((group) => {
      const spellings = [...group.spellings.entries()].sort(
        (a, b) => Number(isMixedCase(b[0])) - Number(isMixedCase(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      return { label: presentableLabel(spellings[0][0]), names: group.names };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The other labels that a multi-word label consists of, when it consists of nothing else.
function placesWithin(group: CityGroup, groups: Map<string, CityGroup>): CityGroup[] | null {
  const { tokens } = group;
  const reach: Array<CityGroup[] | null> = Array.from({ length: tokens.length + 1 }, () => null);
  reach[0] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    const soFar = reach[start];
    if (!soFar) continue;
    if (soFar.length > 0 && JOINING_WORDS.has(tokens[start]) && !reach[start + 1]) reach[start + 1] = soFar;
    for (let end = start + 1; end <= tokens.length; end += 1) {
      const part = groups.get(tokens.slice(start, end).join(""));
      if (part && part !== group && !part.withRegion && !reach[end]) reach[end] = [...soFar, part];
    }
  }
  const parts = reach[tokens.length];
  return parts && new Set(parts).size >= 2 ? [...new Set(parts)] : null;
}

export function citiesFromStates(states: RadioState[], countryName: string, countryCode?: string): RadioCity[] {
  // One entry per place (see "City / area list" above); the spelling with the most stations
  // is shown. Rows that name a different country are dropped.
  const country = normalizedLocation(countryName);
  return buildCities(
    states
      .filter((state) => state.country === undefined || normalizedLocation(state.country) === country)
      .map((state) => ({ name: state.name, weight: Number(state.stationcount) || 0 })),
    { name: countryName, code: countryCode },
  );
}

export function citiesFromStations(stations: RadioStation[], countryName?: string, countryCode?: string): RadioCity[] {
  // Uses the documented `state` field only, because that is what station lookups can query.
  return buildCities(stations.map((station) => ({ name: station.state, weight: 1 })), { name: countryName, code: countryCode });
}

export function stationFrequencyTenths(station: RadioStation): number | null {
  const directValues = [station.frequency, station.frequency_mhz];
  for (const value of directValues) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
    if (Number.isFinite(parsed) && parsed >= 87.5 && parsed <= 108) {
      return Math.round(parsed * 10);
    }
  }

  // Only parse a frequency when the station label explicitly marks FM/MHz.
  // The public Radio Browser schema does not define a terrestrial FM frequency field.
  const text = `${station.name} ${station.tags ?? ""}`;
  const match = text.match(/\b(87\.[5-9]\d*|8[89]\.\d+|9\d\.\d+|10\d\.\d+|108(?:\.0+)?)\s*(?:FM|MHz)\b/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed < 87.5 || parsed > 108) return null;
  return Math.round(parsed * 10);
}

export function secureStreamUrl(station: RadioStation): string | null {
  for (const candidate of [station.url_resolved, station.url]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // Ignore malformed station metadata and continue to the next URL.
    }
  }
  return null;
}

// Answers "can this browser play this kind of audio at all?" for a MIME type.
export type CanPlay = (mimeType: string) => boolean;

const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";
// Radio Browser codec names whose browser MIME type is certain. Any other value is left alone.
const CODEC_MIME_TYPES: Record<string, string> = {
  MP3: "audio/mpeg",
  AAC: "audio/aac",
  "AAC+": "audio/aac",
  OGG: "audio/ogg",
  FLAC: "audio/flac",
  WMA: "audio/x-ms-wma",
};
const PLAYLIST_FILE = /\.(pls|m3u|asx|xspf|wax|wvx)$/i;
const HLS_FILE = /\.m3u8$/i;

let supportProbe: HTMLAudioElement | undefined;
function browserCanPlay(mimeType: string): boolean {
  // Outside a browser nothing can be determined, so nothing is ruled out.
  if (typeof document === "undefined") return true;
  supportProbe ??= document.createElement("audio");
  return supportProbe.canPlayType(mimeType) !== "";
}

// The station's HTTPS stream addresses this browser can actually play, best first
// (the resolved address, then the address the station was registered with).
// Empty when the directory's own data rules the station out: a certificate error,
// an HLS stream or a codec the browser cannot play, or only playlist files / plain http.
export function streamCandidates(station: RadioStation, canPlay: CanPlay = browserCanPlay): string[] {
  if (Number(station.ssl_error) === 1) return [];
  const playsHls = canPlay(HLS_MIME_TYPE);
  if (Number(station.hls) === 1 && !playsHls) return [];
  const codecMimeType = CODEC_MIME_TYPES[(station.codec ?? "").trim().toUpperCase()];
  if (codecMimeType && !canPlay(codecMimeType)) return [];

  const candidates: string[] = [];
  for (const candidate of [station.url_resolved, station.url]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:") continue;
      if (PLAYLIST_FILE.test(url.pathname)) continue;
      if (HLS_FILE.test(url.pathname) && !playsHls) continue;
      if (!candidates.includes(url.toString())) candidates.push(url.toString());
    } catch {
      // Ignore malformed station metadata and continue to the next URL.
    }
  }
  return candidates;
}

export function isPlayableStation(station: RadioStation, canPlay: CanPlay = browserCanPlay): boolean {
  return streamCandidates(station, canPlay).length > 0;
}

function stationSearchPath(params: Record<string, string | number | boolean | undefined>) {
  return `/json/stations/search?${buildQuery({
    ...params,
    hidebroken: true,
    is_https: true,
    limit: params.limit ?? 500,
    order: "clickcount",
    reverse: true,
  })}`;
}

function deduplicateStations(stations: RadioStation[]) {
  const unique = new Map<string, RadioStation>();
  for (const station of stations) {
    if (station.stationuuid) unique.set(station.stationuuid, station);
  }
  return [...unique.values()];
}

export function deduplicateCountries(countries: RadioCountry[]): RadioCountry[] {
  // Radio Browser can list the same ISO 3166-1 code more than once. Keep one entry
  // per code (the one with the most stations), exactly as the directory supplied it.
  const unique = new Map<string, RadioCountry>();
  for (const country of countries) {
    const code = country.iso_3166_1.trim().toUpperCase();
    const kept = unique.get(code);
    if (!kept || Number(country.stationcount) > Number(kept.stationcount)) unique.set(code, country);
  }
  return [...unique.values()];
}

// ---------------------------------------------------------------------------
// Directory cache
//
// Countries and city lists are kept for up to 24 hours (in memory and in the browser's
// storage, so they survive a page reload). Station lists are kept in memory for this page
// only. An identical request that is already on its way is shared instead of started again,
// and a request is cancelled once nobody is waiting for it any more.

export const DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Upper limit for all stored city lists together (characters in browser storage).
export const CITY_STORAGE_MAX_CHARS = 1_500_000;
// City lists kept in memory at once.
export const CITY_MEMORY_MAX_COUNTRIES = 50;
// Stations kept in memory at once, across all cached city station lists.
export const STATION_CACHE_MAX_STATIONS = 5000;

const STORAGE_PREFIX = "radio-directory:1:";
const STORED_COUNTRIES = "countries";
// City lists are stored as they are shown. "cities2:" holds lists cleaned by the current
// rules; lists saved under the earlier name are not reused and are removed.
const STORED_CITIES = "cities2:";
const STORED_CITIES_BEFORE = "cities:";

interface Timed<T> {
  savedAt: number;
  value: T;
}
interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface SharedRequest<T> {
  promise: Promise<T>;
  controller: AbortController;
  waiting: number;
}

let countriesMemory: Timed<RadioCountry[]> | undefined;
const citiesMemory = new Map<string, Timed<RadioCity[]>>();
const stationsMemory = new Map<string, Timed<RadioStation[]>>();
const requestsInFlight = new Map<string, SharedRequest<unknown>>();

// Forgets everything held in memory, as a fresh page load does. Browser storage is kept.
export function resetDirectoryMemory() {
  countriesMemory = undefined;
  citiesMemory.clear();
  stationsMemory.clear();
  requestsInFlight.clear();
}

function isFresh(savedAt: number) {
  const age = Date.now() - savedAt;
  return age >= 0 && age < DIRECTORY_CACHE_TTL_MS;
}

function directoryStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored<T>(name: string): Timed<T[]> | undefined {
  const storage = directoryStorage();
  if (!storage) return undefined;
  const key = STORAGE_PREFIX + name;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return undefined;
    const split = raw.indexOf("\n");
    const savedAt = Number(raw.slice(0, split));
    if (split > 0 && isFresh(savedAt)) {
      const value: unknown = JSON.parse(raw.slice(split + 1));
      if (Array.isArray(value)) return { savedAt, value: value as T[] };
    }
    // Expired or unreadable: remove it.
    storage.removeItem(key);
  } catch {
    // Storage is unavailable or the entry is damaged: behave as if nothing was stored.
  }
  return undefined;
}

function storedCityEntries(storage: StorageLike) {
  const entries: Array<{ key: string; savedAt: number; size: number }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(STORAGE_PREFIX + STORED_CITIES)) continue;
    const raw = storage.getItem(key) ?? "";
    entries.push({ key, savedAt: Number(raw.slice(0, raw.indexOf("\n"))), size: raw.length });
  }
  return entries;
}

function writeStored(name: string, entry: Timed<unknown>) {
  const storage = directoryStorage();
  if (!storage) return;
  const key = STORAGE_PREFIX + name;
  const text = `${entry.savedAt}\n${JSON.stringify(entry.value)}`;
  try {
    if (name.startsWith(STORED_CITIES)) {
      if (text.length > CITY_STORAGE_MAX_CHARS) return;
      // Lists saved under the earlier name are of no further use.
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const stale = storage.key(index);
        if (stale?.startsWith(STORAGE_PREFIX + STORED_CITIES_BEFORE)) storage.removeItem(stale);
      }
      // Make room: expired lists first, then the oldest ones.
      const others = storedCityEntries(storage).filter((other) => other.key !== key);
      let total = text.length;
      for (const other of others.sort((a, b) => b.savedAt - a.savedAt)) {
        if (isFresh(other.savedAt) && total + other.size <= CITY_STORAGE_MAX_CHARS) total += other.size;
        else storage.removeItem(other.key);
      }
    }
    storage.setItem(key, text);
  } catch {
    // Storage is full or unavailable: the copy in memory still serves this page.
  }
}

function cachedCountries(): RadioCountry[] | undefined {
  if (countriesMemory && !isFresh(countriesMemory.savedAt)) countriesMemory = undefined;
  countriesMemory ??= readStored<RadioCountry>(STORED_COUNTRIES);
  return countriesMemory?.value;
}

function rememberCities(countryCode: string, entry: Timed<RadioCity[]>) {
  citiesMemory.delete(countryCode);
  citiesMemory.set(countryCode, entry);
  for (const oldest of citiesMemory.keys()) {
    if (citiesMemory.size <= CITY_MEMORY_MAX_COUNTRIES) break;
    citiesMemory.delete(oldest);
  }
}

function cachedCities(countryCode: string): RadioCity[] | undefined {
  const held = citiesMemory.get(countryCode);
  if (held && isFresh(held.savedAt)) return held.value;
  citiesMemory.delete(countryCode);
  const stored = readStored<RadioCity>(STORED_CITIES + countryCode);
  if (stored) rememberCities(countryCode, stored);
  return stored?.value;
}

function cachedStations(key: string): RadioStation[] | undefined {
  const held = stationsMemory.get(key);
  if (!held) return undefined;
  stationsMemory.delete(key);
  if (!isFresh(held.savedAt)) return undefined;
  stationsMemory.set(key, held); // most recently used goes last
  return held.value;
}

function rememberStations(key: string, stations: RadioStation[]) {
  stationsMemory.delete(key);
  stationsMemory.set(key, { savedAt: Date.now(), value: stations });
  let total = 0;
  for (const held of stationsMemory.values()) total += held.value.length;
  for (const [oldest, held] of stationsMemory) {
    if (total <= STATION_CACHE_MAX_STATIONS || oldest === key) break;
    stationsMemory.delete(oldest);
    total -= held.value.length;
  }
}

function supersededError() {
  return new DOMException("The request is no longer needed.", "AbortError");
}

// Runs `start` once per key. Later callers with the same key join the request already on
// its way. A caller leaves by aborting its own signal; when the last caller has left, the
// request itself is cancelled. A caller without a signal keeps the request alive.
function sharedRequest<T>(key: string, signal: AbortSignal | undefined, start: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (signal?.aborted) return Promise.reject(supersededError());

  let request = requestsInFlight.get(key) as SharedRequest<T> | undefined;
  if (!request) {
    const controller = new AbortController();
    const created: SharedRequest<T> = {
      controller,
      waiting: 0,
      promise: start(controller.signal).finally(() => {
        if (requestsInFlight.get(key) === created) requestsInFlight.delete(key);
      }),
    };
    created.promise.catch(() => {}); // every caller handles the outcome itself
    requestsInFlight.set(key, created);
    request = created;
  }

  const joined = request;
  joined.waiting += 1;
  if (!signal) return joined.promise;

  return new Promise<T>((resolve, reject) => {
    const leave = () => {
      reject(supersededError());
      joined.waiting -= 1;
      if (joined.waiting > 0) return;
      if (requestsInFlight.get(key) === joined) requestsInFlight.delete(key);
      joined.controller.abort();
    };
    signal.addEventListener("abort", leave, { once: true });
    joined.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", leave));
  });
}

export const radioDirectory = {
  async listCountries(signal?: AbortSignal): Promise<RadioCountry[]> {
    const cached = cachedCountries();
    if (cached) return cached;

    return sharedRequest(STORED_COUNTRIES, signal, async (shared) => {
      const query = buildQuery({ order: "name", hidebroken: true, limit: 500 });
      const countries = await fetchFromDirectory<RadioCountry[]>(`/json/countries?${query}`, shared);
      const list = deduplicateCountries(countries.filter((country) => country.name && country.iso_3166_1))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (list.length > 0) {
        countriesMemory = { savedAt: Date.now(), value: list };
        writeStored(STORED_COUNTRIES, countriesMemory);
      }
      return list;
    });
  },

  async listCountryStations(countryCode: string, signal?: AbortSignal, limit = 1000): Promise<RadioStation[]> {
    const path = stationSearchPath({ countrycode: countryCode, limit });
    return fetchFromDirectory<RadioStation[]>(path, signal);
  },

  // The most popular stations registered with coordinates around a point. The point should
  // already be rounded (see roundCoordinate). Callers check the distances themselves, so a
  // server that ignored the distance could not put the listener in the wrong place.
  async listNearbyStations(latitude: number, longitude: number, radiusKm: number, signal?: AbortSignal): Promise<RadioStation[]> {
    const path = stationSearchPath({
      geo_lat: latitude,
      geo_long: longitude,
      geo_distance: Math.round(radiusKm * 1000),
      has_geo_info: true,
      limit: NEARBY_STATION_LIMIT,
    });
    return fetchFromDirectory<RadioStation[]>(path, signal);
  },

  // The country's city list if it is already known, without any request.
  peekCountryCities(country: Pick<RadioCountry, "iso_3166_1">): RadioCity[] | undefined {
    return cachedCities(country.iso_3166_1);
  },

  async listCountryCities(
    country: Pick<RadioCountry, "name" | "iso_3166_1">,
    signal?: AbortSignal,
  ): Promise<RadioCity[]> {
    const cached = cachedCities(country.iso_3166_1);
    if (cached) return cached;

    return sharedRequest(STORED_CITIES + country.iso_3166_1, signal, async (shared) => {
      // Radio Browser has no city directory and no city field. Its only per-country location
      // listing is /json/states/<country name>/, which counts every station's free-text
      // `state` label for that country (not just the most popular stations).
      try {
        const query = buildQuery({ order: "name", hidebroken: true });
        const states = await fetchFromDirectory<RadioState[]>(
          `/json/states/${encodeURIComponent(country.name)}/?${query}`,
          shared,
        );
        const cities = citiesFromStates(states, country.name, country.iso_3166_1);
        if (cities.length > 0) {
          const entry = { savedAt: Date.now(), value: cities };
          rememberCities(country.iso_3166_1, entry);
          writeStored(STORED_CITIES + country.iso_3166_1, entry);
          return cities;
        }
      } catch (error) {
        if (shared.aborted) throw error;
      }

      // The listing was unavailable or empty for this country name: fall back to the labels
      // found on the country's most popular stations. Kept for this page only, so the full
      // listing is tried again on the next visit.
      const fallback = citiesFromStations(
        await radioDirectory.listCountryStations(country.iso_3166_1, shared),
        country.name,
        country.iso_3166_1,
      );
      rememberCities(country.iso_3166_1, { savedAt: Date.now(), value: fallback });
      return fallback;
    });
  },

  async listCityStations(countryCode: string, city: RadioCity, signal?: AbortSignal): Promise<RadioStation[]> {
    const key = [countryCode, ...city.names].join("\u0000");
    const stations =
      cachedStations(key) ??
      (await sharedRequest(`stations:${key}`, signal, async (shared) => {
        const results = await Promise.all(
          city.names.map((name) =>
            fetchFromDirectory<RadioStation[]>(
              stationSearchPath({ countrycode: countryCode, state: name, stateExact: true }),
              shared,
            ),
          ),
        );
        const list = deduplicateStations(results.flat());
        rememberStations(key, list);
        return list;
      }));
    // The playability check runs on every read, cached or not.
    return stations
      .filter((station) => isPlayableStation(station))
      .sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));
  },
};

// How long the knob must rest on a country before its city list is requested.
export const KNOB_SETTLE_MS = 300;

export type CityListReport =
  | { status: "loading" }
  | { status: "ready"; cities: RadioCity[] }
  | { status: "error" };

export interface CityListLoader {
  // Loads the city list of the chosen country and reports it. A list that is already known
  // is reported at once. Otherwise the request starts after `settleMs` without another
  // choice, so passing over countries with the knob does not request each of them.
  load(country: Pick<RadioCountry, "name" | "iso_3166_1">, settleMs?: number): void;
  // Drops the current choice: a waiting request is not started, a running one is cancelled.
  cancel(): void;
}

export function createCityListLoader(report: (result: CityListReport) => void): CityListLoader {
  let generation = 0; // goes up whenever the current choice is dropped
  let currentCode: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function cancel() {
    generation += 1;
    currentCode = undefined;
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  return {
    cancel,
    load(country, settleMs = 0) {
      const cached = radioDirectory.peekCountryCities(country);
      const onItsWay = currentCode === country.iso_3166_1 && (timer !== undefined || controller !== undefined);
      if (onItsWay && !cached) return;

      cancel();
      currentCode = country.iso_3166_1;
      if (cached) {
        report({ status: "ready", cities: cached });
        return;
      }

      report({ status: "loading" });
      const mine = generation;
      const start = () => {
        timer = undefined;
        const own = new AbortController();
        controller = own;
        radioDirectory.listCountryCities(country, own.signal).then(
          (cities) => {
            if (mine !== generation) return;
            controller = undefined;
            report({ status: "ready", cities });
          },
          () => {
            if (mine !== generation) return;
            controller = undefined;
            report({ status: "error" });
          },
        );
      };
      if (settleMs > 0) timer = setTimeout(start, settleMs);
      else start();
    },
  };
}

export type PlaybackStatus = "connecting" | "playing" | "error";
export type PlaybackFailure = "no-secure-stream" | "blocked" | "unavailable";

// The parts of an <audio> element the player uses (an HTMLAudioElement fits).
export interface PlayerAudio {
  preload: string;
  volume: number;
  readonly currentTime: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
}

export interface StationPlayer {
  // Stops whatever is playing and starts this station. `volume` is 0 to 1.
  play(station: RadioStation, volume: number): void;
  // Stops and releases the current stream without reporting anything.
  stop(): void;
  setVolume(volume: number): void;
}

export interface StationPlayerOptions {
  createAudio: (url: string) => PlayerAudio;
  onChange: (status: PlaybackStatus, failure?: PlaybackFailure) => void;
  canPlay?: CanPlay;
}

// A stream that gives no audio within this time is treated as failed.
export const CONNECT_TIMEOUT_MS = 12000;
// While on air, playback progress is checked this often; this many checks in a row
// without progress (15 seconds) mean the stream has stalled.
export const STALL_CHECK_MS = 5000;
export const STALL_CHECKS = 3;
// A stream that has been on air this long has earned a fresh reconnect if it drops again.
export const STABLE_PLAYBACK_MS = 30000;

export function createStationPlayer(options: StationPlayerOptions): StationPlayer {
  let session = 0; // goes up on every play() and stop(); anything from an older session is ignored
  let audio: PlayerAudio | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let volume = 1;

  // Stops the current stream and closes its connection (pausing alone keeps it open).
  function release() {
    clearTimeout(timer);
    timer = undefined;
    const current = audio;
    if (!current) return;
    audio = null;
    current.pause();
    current.removeAttribute("src");
    current.load();
  }

  function attempt(id: number, urls: string[], index: number, isReconnect: boolean) {
    release();
    const player = options.createAudio(urls[index]);
    player.preload = "none";
    player.volume = volume;
    audio = player;

    let onAirSince: number | null = null;
    let lastTime = 0;
    let checksWithoutProgress = 0;
    const isCurrent = () => session === id && audio === player;

    const fail = (failure: PlaybackFailure) => {
      if (!isCurrent()) return;
      const wasOnAir = onAirSince !== null;
      const wasStable = onAirSince !== null && Date.now() - onAirSince >= STABLE_PLAYBACK_MS;
      release();
      if (failure === "blocked") {
        options.onChange("error", "blocked");
      } else if (wasOnAir && (!isReconnect || wasStable)) {
        // It was playing and then ended or stalled: reconnect once.
        options.onChange("connecting");
        attempt(id, urls, index, true);
      } else if (!wasOnAir && !isReconnect && index + 1 < urls.length) {
        // This address never produced audio: try the station's other address.
        attempt(id, urls, index + 1, false);
      } else {
        options.onChange("error", "unavailable");
      }
    };

    const watchProgress = () => {
      timer = setTimeout(() => {
        if (!isCurrent()) return;
        if (player.currentTime > lastTime) {
          lastTime = player.currentTime;
          checksWithoutProgress = 0;
        } else {
          checksWithoutProgress += 1;
          if (checksWithoutProgress >= STALL_CHECKS) {
            fail("unavailable");
            return;
          }
        }
        watchProgress();
      }, STALL_CHECK_MS);
    };

    player.addEventListener("playing", () => {
      if (!isCurrent()) return;
      onAirSince ??= Date.now();
      clearTimeout(timer);
      lastTime = player.currentTime;
      checksWithoutProgress = 0;
      watchProgress();
      options.onChange("playing");
    });
    player.addEventListener("error", () => fail("unavailable"));
    player.addEventListener("ended", () => fail("unavailable"));

    timer = setTimeout(() => fail("unavailable"), CONNECT_TIMEOUT_MS);
    void player.play().catch((error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      // AbortError only means play() was interrupted by stopping or switching.
      if (name === "AbortError") return;
      fail(name === "NotAllowedError" ? "blocked" : "unavailable");
    });
  }

  return {
    play(station, nextVolume) {
      session += 1;
      volume = nextVolume;
      release();
      const urls = streamCandidates(station, options.canPlay);
      if (urls.length === 0) {
        options.onChange("error", "no-secure-stream");
        return;
      }
      options.onChange("connecting");
      attempt(session, urls, 0, false);
    },
    stop() {
      session += 1;
      release();
    },
    setVolume(nextVolume) {
      volume = nextVolume;
      if (audio) audio.volume = nextVolume;
    },
  };
}

// ---------------------------------------------------------------------------
// Automatic local station
//
// When the radio opens, it asks the browser where the listener is, looks up the stations the
// directory has around that point, takes the country and the city label those stations carry,
// and picks the best playable station of that city. Nothing here plays anything.
//
// Privacy: only a point rounded to one decimal place (about 11 km) is sent to the directory.
// The position itself is never stored; only the country, the city label and the time are.

// A place found by location is used again for this long without asking the browser.
export const LOCAL_PLACE_TTL_MS = 24 * 60 * 60 * 1000;
// After the listener says no, the browser is not asked again for this long.
export const LOCATION_DENIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// The browser's own time limit for finding the position once it is allowed to.
export const LOCATION_TIMEOUT_MS = 10000;
// Our time limit for the whole question, including a permission prompt nobody answers.
export const LOCATION_WAIT_MS = 20000;
// A position the browser already knows may be this old.
export const LOCATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Stations are looked for within the first distance, then once more within the second.
export const NEARBY_RADII_KM = [100, 300];
export const NEARBY_STATION_LIMIT = 100;
// How many of a country's most popular stations the country-only fallback looks at.
export const COUNTRY_FALLBACK_LIMIT = 50;
// A station with an FM frequency is preferred when it is among this many most popular.
export const FREQUENCY_PREFERENCE_TOP = 10;
// How many of the place's labels are tried before giving up on a city.
const LOCAL_LABEL_ATTEMPTS = 3;

const PLACE_KEY = "radio-location:1:place";
const DENIAL_KEY = "radio-location:1:declined";

// One decimal place: about 11 km. Precise enough to find the city, not the street.
export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10 || 0;
}

export function distanceKm(aLatitude: number, aLongitude: number, bLatitude: number, bLongitude: number): number {
  const radians = Math.PI / 180;
  const dLatitude = (bLatitude - aLatitude) * radians;
  const dLongitude = (bLongitude - aLongitude) * radians;
  const h =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(aLatitude * radians) * Math.cos(bLatitude * radians) * Math.sin(dLongitude / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface NearbyStation {
  station: RadioStation;
  km: number;
}

// The stations whose own coordinates really are within `radiusKm` of the point, nearest first.
export function stationsWithinKm(stations: RadioStation[], latitude: number, longitude: number, radiusKm: number): NearbyStation[] {
  const nearby: NearbyStation[] = [];
  for (const station of stations) {
    const { geo_lat: stationLatitude, geo_long: stationLongitude } = station;
    if (typeof stationLatitude !== "number" || typeof stationLongitude !== "number") continue;
    if (!Number.isFinite(stationLatitude) || !Number.isFinite(stationLongitude)) continue;
    const km = distanceKm(latitude, longitude, stationLatitude, stationLongitude);
    if (km <= radiusKm) nearby.push({ station, km });
  }
  return nearby.sort((a, b) => a.km - b.km);
}

export interface LocalPlace {
  countryCode: string;
  // City / area labels found around the listener, the most likely first.
  labels: string[];
}

// The country and city labels of the playable stations around the listener. Every station
// votes for its own country and label; nearer and more popular stations count for more.
export function resolveLocalPlace(nearby: NearbyStation[], canPlay: CanPlay = browserCanPlay): LocalPlace | null {
  const countries = new Map<string, { weight: number; labels: Map<string, { label: string; weight: number }> }>();
  for (const { station, km } of nearby) {
    const countryCode = (station.countrycode ?? "").trim().toUpperCase();
    if (!countryCode || !isPlayableStation(station, canPlay)) continue;
    const weight = (1 + Math.log10(1 + Math.max(0, station.clickcount ?? 0))) / (1 + km / 25);
    const country = countries.get(countryCode) ?? { weight: 0, labels: new Map() };
    country.weight += weight;
    countries.set(countryCode, country);

    const key = normalizedLocation(station.state);
    if (!key) continue;
    const label = country.labels.get(key) ?? { label: (station.state ?? "").trim().replace(/\s+/g, " "), weight: 0 };
    label.weight += weight;
    country.labels.set(key, label);
  }

  const best = [...countries.entries()].sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))[0];
  if (!best) return null;
  return {
    countryCode: best[0],
    labels: [...best[1].labels.values()]
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
      .map((entry) => entry.label),
  };
}

// The entry of a country's city list that a label belongs to (any of its spellings).
export function findCity(cities: RadioCity[], label: string): RadioCity | undefined {
  const wanted = normalizedLocation(label);
  if (!wanted) return undefined;
  return cities.find(
    (city) => normalizedLocation(city.label) === wanted || city.names.some((name) => normalizedLocation(name) === wanted),
  );
}

// The station the radio tunes to by itself: the most popular playable one, except that a
// station with an FM frequency is taken when it is among the most popular few, so the dial
// shows a real number.
export function pickLocalStation(stations: RadioStation[], canPlay: CanPlay = browserCanPlay): RadioStation | null {
  const playable = stations
    .filter((station) => isPlayableStation(station, canPlay))
    .sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));
  if (playable.length === 0) return null;
  return (
    playable.slice(0, FREQUENCY_PREFERENCE_TOP).find((station) => stationFrequencyTenths(station) !== null) ?? playable[0]
  );
}

// Browsers disagree on the spelling of a few renamed time zones.
const TIME_ZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Macao": "Asia/Macau",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Africa/Asmera": "Africa/Asmara",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
};
const canonicalTimeZone = (zone: string) => TIME_ZONE_ALIASES[zone] ?? zone;

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function browserZonesOf(countryCode: string): string[] {
  try {
    const locale = new Intl.Locale(`und-${countryCode}`) as Intl.Locale & {
      getTimeZones?: () => string[] | undefined;
      timeZones?: string[];
    };
    return (typeof locale.getTimeZones === "function" ? locale.getTimeZones() : locale.timeZones) ?? [];
  } catch {
    return [];
  }
}

// The country the device's clock is set for, out of the given country codes. Needs no
// permission and no request. Null when the browser cannot tell or more than one country fits.
export function countryFromTimeZone(
  countryCodes: string[],
  timeZone: string | undefined = browserTimeZone(),
  zonesOf: (countryCode: string) => string[] = browserZonesOf,
): string | null {
  if (!timeZone) return null;
  const wanted = canonicalTimeZone(timeZone);
  const matches = [...new Set(countryCodes.map((code) => code.trim().toUpperCase()))].filter(
    (code) => /^[A-Z]{2}$/.test(code) && zonesOf(code).some((zone) => canonicalTimeZone(zone) === wanted),
  );
  return matches.length === 1 ? matches[0] : null;
}

// The parts of the browser's location and permission features the tuner uses.
export interface GeolocationLike {
  getCurrentPosition(
    onPosition: (position: { coords: { latitude: number; longitude: number } }) => void,
    onError?: (error: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}
export interface PermissionsLike {
  query(descriptor: { name: "geolocation" }): Promise<{ state: string }>;
}

interface RememberedPlace {
  savedAt: number;
  countryCode: string;
  cityLabel: string;
}

const isWithin = (savedAt: number, lifetime: number) => {
  const age = Date.now() - savedAt;
  return Number.isFinite(age) && age >= 0 && age < lifetime;
};

function rememberedPlace(storage: StorageLike | null): RememberedPlace | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(PLACE_KEY);
    if (raw === null) return undefined;
    const place = JSON.parse(raw) as Partial<RememberedPlace> | null;
    if (
      place &&
      typeof place.savedAt === "number" &&
      isWithin(place.savedAt, LOCAL_PLACE_TTL_MS) &&
      typeof place.countryCode === "string" &&
      typeof place.cityLabel === "string"
    ) {
      return { savedAt: place.savedAt, countryCode: place.countryCode, cityLabel: place.cityLabel };
    }
    storage.removeItem(PLACE_KEY); // expired or unreadable
  } catch {
    // Storage is unavailable or the entry is damaged: behave as if nothing was stored.
  }
  return undefined;
}

function store(storage: StorageLike | null, key: string, value: string | null) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage is full or unavailable: nothing is remembered, which only means asking again.
  }
}

function denialRemembered(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(DENIAL_KEY);
    if (raw === null) return false;
    if (isWithin(Number(raw), LOCATION_DENIAL_TTL_MS)) return true;
    storage.removeItem(DENIAL_KEY);
  } catch {
    // Unreadable: behave as if nothing was stored.
  }
  return false;
}

function browserGeolocation(): GeolocationLike | null {
  return typeof navigator === "undefined" ? null : (navigator.geolocation ?? null);
}

function browserPermissions(): PermissionsLike | null {
  return typeof navigator === "undefined" ? null : ((navigator.permissions as PermissionsLike | undefined) ?? null);
}

// How the station was found: by the listener's position, from the place remembered from an
// earlier visit, or for the country alone (when the position is not available).
export type LocalTuneSource = "location" | "remembered" | "country";

export interface LocalTuneResult {
  source: LocalTuneSource;
  country: RadioCountry;
  // The city the station belongs to, with the country's city list; null when only the country is known.
  city: RadioCity | null;
  cities: RadioCity[];
  // The playable stations the chosen one was picked from, most popular first.
  stations: RadioStation[];
  station: RadioStation;
}

export interface LocationTuner {
  // Starts looking for the listener's local station. `onTuned` is called at most once, and
  // not at all when nothing suitable is found or the search is cancelled first.
  start(): void;
  // The listener has chosen for themselves (or the radio is going away): requests are
  // cancelled, nothing is reported any more, and a station waiting to start is dropped.
  cancel(): void;
  // The automatically chosen station, handed out once, for the listener's first action to
  // start it (a page may not start sound by itself). Null when there is none waiting.
  claimStart(): RadioStation | null;
}

export interface LocationTunerOptions {
  onTuned: (result: LocalTuneResult) => void;
  // Defaults: the browser's own. Pass null for "not available".
  geolocation?: GeolocationLike | null;
  permissions?: PermissionsLike | null;
  storage?: StorageLike | null;
  timeZone?: string;
  zonesOf?: (countryCode: string) => string[];
  canPlay?: CanPlay;
}

type PositionAnswer = { latitude: number; longitude: number } | "denied" | "unavailable";

export function createLocationTuner(options: LocationTunerOptions): LocationTuner {
  const geolocation = options.geolocation === undefined ? browserGeolocation() : options.geolocation;
  const permissions = options.permissions === undefined ? browserPermissions() : options.permissions;
  const storage = options.storage === undefined ? directoryStorage() : options.storage;
  const canPlay = options.canPlay ?? browserCanPlay;
  const byPopularity = (a: RadioStation, b: RadioStation) => (b.clickcount ?? 0) - (a.clickcount ?? 0);

  let run = 0; // goes up on every start() and cancel(); anything from an older run is ignored
  let controller: AbortController | undefined;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  let waitingToStart: RadioStation | null = null;

  async function askPosition(source: GeolocationLike): Promise<PositionAnswer> {
    // A browser that already holds a "no" is not asked again.
    try {
      if ((await permissions?.query({ name: "geolocation" }))?.state === "denied") return "unavailable";
    } catch {
      // The permission cannot be read in this browser: just ask.
    }

    return new Promise<PositionAnswer>((resolve) => {
      let answered = false;
      const answer = (value: PositionAnswer) => {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        resolve(value);
      };
      // The browser's own time limit only starts once the listener has allowed the question,
      // so a prompt nobody answers needs a limit of its own.
      const timer = setTimeout(() => answer("unavailable"), LOCATION_WAIT_MS);
      waitTimer = timer;
      try {
        source.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            answer(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : "unavailable");
          },
          (error) => {
            // A "no" is the listener's answer even if it arrives late: remember it either way.
            if (error?.code === 1) store(storage, DENIAL_KEY, String(Date.now()));
            answer(error?.code === 1 ? "denied" : "unavailable");
          },
          { enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: LOCATION_MAX_AGE_MS },
        );
      } catch {
        answer("unavailable");
      }
    });
  }

  // The best station of the first of these labels that has a playable one.
  async function tuneToCity(country: RadioCountry, labels: string[], signal: AbortSignal) {
    if (labels.length === 0) return null;
    const cities = await radioDirectory.listCountryCities(country, signal);
    for (const label of labels.slice(0, LOCAL_LABEL_ATTEMPTS)) {
      const city = findCity(cities, label);
      if (!city) continue;
      const stations = await radioDirectory.listCityStations(country.iso_3166_1, city, signal);
      const station = pickLocalStation(stations, canPlay);
      if (station) return { country, city, cities, stations, station };
    }
    return null;
  }

  async function placeAround(latitude: number, longitude: number, signal: AbortSignal) {
    for (const radiusKm of NEARBY_RADII_KM) {
      const stations = await radioDirectory.listNearbyStations(latitude, longitude, radiusKm, signal);
      const place = resolveLocalPlace(stationsWithinKm(stations, latitude, longitude, radiusKm), canPlay);
      if (place) return place;
    }
    return null;
  }

  async function detect(mine: number, signal: AbortSignal) {
    const current = () => mine === run;
    const report = (result: LocalTuneResult) => {
      if (!current()) return;
      run += 1; // finished: nothing further is reported for this start()
      waitingToStart = result.station;
      options.onTuned(result);
    };
    // A failed step is skipped (the next fallback is tried); a cancelled search stops.
    const attempt = async <T>(step: () => Promise<T | null>): Promise<T | null> => {
      try {
        return await step();
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      }
    };

    const countries = await radioDirectory.listCountries(signal);
    if (!current()) return;
    const countryOf = (code: string) =>
      countries.find((country) => country.iso_3166_1.trim().toUpperCase() === code.trim().toUpperCase());

    // 1. A place found by location within the last 24 hours: the browser is not asked again.
    const remembered = rememberedPlace(storage);
    if (remembered) {
      const country = countryOf(remembered.countryCode);
      const found = country ? await attempt(() => tuneToCity(country, [remembered.cityLabel], signal)) : null;
      if (!current()) return;
      if (found) return report({ source: "remembered", ...found });
    }

    // 2. Ask the browser, unless the listener said no within the last 7 days.
    let knownCountry: RadioCountry | undefined;
    if (geolocation && !denialRemembered(storage)) {
      const position = await askPosition(geolocation);
      if (!current()) return;
      if (typeof position === "object") {
        const latitude = roundCoordinate(position.latitude);
        const longitude = roundCoordinate(position.longitude);
        const place = await attempt(() => placeAround(latitude, longitude, signal));
        if (!current()) return;
        knownCountry = place ? countryOf(place.countryCode) : undefined;
        if (place && knownCountry) {
          const country = knownCountry;
          const found = await attempt(() => tuneToCity(country, place.labels, signal));
          if (!current()) return;
          if (found) {
            const entry: RememberedPlace = { savedAt: Date.now(), countryCode: country.iso_3166_1, cityLabel: found.city.label };
            store(storage, PLACE_KEY, JSON.stringify(entry));
            return report({ source: "location", ...found });
          }
        }
      }
    }

    // 3. The country alone: the one the nearby stations are in, else the one the device's
    //    time zone belongs to. Its most popular playable station, with that station's city.
    const fallbackCode = countryFromTimeZone(countries.map((entry) => entry.iso_3166_1), options.timeZone, options.zonesOf);
    const country = knownCountry ?? (fallbackCode ? countryOf(fallbackCode) : undefined);
    if (!country) return;
    const popular = (await radioDirectory.listCountryStations(country.iso_3166_1, signal, COUNTRY_FALLBACK_LIMIT))
      .filter((station) => isPlayableStation(station, canPlay))
      .sort(byPopularity);
    if (!current() || popular.length === 0) return;

    const labels = [...new Map(popular.map((station) => [normalizedLocation(station.state), station.state ?? ""])).entries()]
      .filter(([key]) => key)
      .map(([, label]) => label);
    const found = await attempt(() => tuneToCity(country, labels, signal));
    if (!current()) return;
    if (found) return report({ source: "country", ...found });

    const station = pickLocalStation(popular, canPlay);
    if (station) report({ source: "country", country, city: null, cities: [], stations: popular, station });
  }

  function cancel() {
    run += 1;
    clearTimeout(waitTimer);
    waitTimer = undefined;
    controller?.abort();
    controller = undefined;
    waitingToStart = null;
  }

  return {
    cancel,
    claimStart() {
      const station = waitingToStart;
      waitingToStart = null;
      return station;
    },
    start() {
      cancel();
      const own = new AbortController();
      controller = own;
      // Any failure (the directory is unreachable, …) leaves the radio exactly as it was.
      detect(run, own.signal).catch(() => {});
    },
  };
}
