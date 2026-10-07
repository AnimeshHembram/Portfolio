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

function buildCities(entries: Array<{ name: string | null | undefined; weight: number }>): RadioCity[] {
  const groups = new Map<string, RadioCity & { weight: number }>();
  for (const { name, weight } of entries) {
    const key = normalizedLocation(name);
    if (!name || !key) continue;
    const label = name.trim().replace(/\s+/g, " ");
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { label, names: [name], weight });
      continue;
    }
    if (!group.names.includes(name)) group.names.push(name);
    if (weight > group.weight) {
      group.label = label;
      group.weight = weight;
    }
  }

  return [...groups.values()]
    .map(({ label, names }) => ({ label, names }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function citiesFromStates(states: RadioState[], countryName: string): RadioCity[] {
  // One city per distinct label, ignoring case and spacing; the spelling with the most
  // stations is shown. Rows that name a different country are dropped.
  const country = normalizedLocation(countryName);
  return buildCities(
    states
      .filter((state) => state.country === undefined || normalizedLocation(state.country) === country)
      .map((state) => ({ name: state.name, weight: Number(state.stationcount) || 0 })),
  );
}

export function citiesFromStations(stations: RadioStation[]): RadioCity[] {
  // Uses the documented `state` field only, because that is what station lookups can query.
  return buildCities(stations.map((station) => ({ name: station.state, weight: 0 })));
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

export const radioDirectory = {
  async listCountries(signal?: AbortSignal): Promise<RadioCountry[]> {
    const query = buildQuery({ order: "name", hidebroken: true, limit: 500 });
    const countries = await fetchFromDirectory<RadioCountry[]>(`/json/countries?${query}`, signal);
    return deduplicateCountries(countries.filter((country) => country.name && country.iso_3166_1))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listCountryStations(countryCode: string, signal?: AbortSignal): Promise<RadioStation[]> {
    const path = stationSearchPath({ countrycode: countryCode, limit: 1000 });
    return fetchFromDirectory<RadioStation[]>(path, signal);
  },

  async listCountryCities(
    country: Pick<RadioCountry, "name" | "iso_3166_1">,
    signal?: AbortSignal,
  ): Promise<RadioCity[]> {
    // Radio Browser has no city directory and no city field. Its only per-country location
    // listing is /json/states/<country name>/, which counts every station's free-text
    // `state` label for that country (not just the most popular stations).
    try {
      const query = buildQuery({ order: "name", hidebroken: true });
      const states = await fetchFromDirectory<RadioState[]>(
        `/json/states/${encodeURIComponent(country.name)}/?${query}`,
        signal,
      );
      const cities = citiesFromStates(states, country.name);
      if (cities.length > 0) return cities;
    } catch (error) {
      if (signal?.aborted) throw error;
    }

    // The listing was unavailable or empty for this country name: fall back to the labels
    // found on the country's most popular stations.
    return citiesFromStations(await radioDirectory.listCountryStations(country.iso_3166_1, signal));
  },

  async listCityStations(countryCode: string, city: RadioCity, signal?: AbortSignal): Promise<RadioStation[]> {
    const results = await Promise.all(
      city.names.map((name) =>
        fetchFromDirectory<RadioStation[]>(
          stationSearchPath({ countrycode: countryCode, state: name, stateExact: true }),
          signal,
        ),
      ),
    );
    return deduplicateStations(results.flat())
      .filter((station) => isPlayableStation(station))
      .sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));
  },
};

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
