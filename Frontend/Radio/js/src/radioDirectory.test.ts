import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CITY_STORAGE_MAX_CHARS,
  CONNECT_TIMEOUT_MS,
  COUNTRY_FALLBACK_LIMIT,
  DIRECTORY_CACHE_TTL_MS,
  FREQUENCY_PREFERENCE_TOP,
  KNOB_SETTLE_MS,
  LOCAL_PLACE_TTL_MS,
  LOCATION_DENIAL_TTL_MS,
  LOCATION_MAX_AGE_MS,
  LOCATION_TIMEOUT_MS,
  LOCATION_WAIT_MS,
  NEARBY_RADII_KM,
  NEARBY_STATION_LIMIT,
  STABLE_PLAYBACK_MS,
  STALL_CHECK_MS,
  STALL_CHECKS,
  STATION_CACHE_MAX_STATIONS,
  citiesFromStates,
  citiesFromStations,
  countryFromTimeZone,
  createCityListLoader,
  createLocationTuner,
  createStationPlayer,
  deduplicateCountries,
  distanceKm,
  findCity,
  groupStationsByLocation,
  isPlayableStation,
  pickLocalStation,
  radioDirectory,
  resetDirectoryMemory,
  resolveLocalPlace,
  roundCoordinate,
  secureStreamUrl,
  stationFrequencyTenths,
  stationsWithinKm,
  streamCandidates,
  type CityListReport,
  type GeolocationLike,
  type LocalTuneResult,
  type LocationTuner,
  type PlayerAudio,
  type RadioStation,
} from "./radioDirectory";

// Every test starts like a freshly opened page: nothing remembered in memory.
beforeEach(() => {
  resetDirectoryMemory();
});

function station(overrides: Partial<RadioStation> = {}): RadioStation {
  return {
    stationuuid: "station-1",
    name: "Example Radio",
    url: "http://radio.example/stream",
    url_resolved: "https://radio.example/stream",
    ...overrides,
  };
}

describe("radio directory data normalization", () => {
  it("reads an explicitly labeled FM frequency without guessing from a bare number", () => {
    expect(stationFrequencyTenths(station({ name: "Example 92.5 FM" }))).toBe(925);
    expect(stationFrequencyTenths(station({ name: "Example 92.5" }))).toBeNull();
  });

  it("uses city when supplied and preserves state/area fallback labels", () => {
    const groups = groupStationsByLocation([
      station({ stationuuid: "a", city: "Ranchi", state: "Jharkhand" }),
      station({ stationuuid: "b", state: "Chennai" }),
      station({ stationuuid: "c", city: null, state: " chennai " }),
      station({ stationuuid: "d", city: null, state: "" }),
    ]);

    expect(groups.map((group) => [group.label, group.stations.length])).toEqual([
      ["Chennai", 2],
      ["Ranchi", 1],
    ]);
  });

  it("selects an HTTPS stream URL and refuses insecure-only streams", () => {
    expect(secureStreamUrl(station({ url: "http://insecure.example/live", url_resolved: "https://secure.example/live" })))
      .toBe("https://secure.example/live");
    expect(secureStreamUrl(station({ url: "http://insecure.example/live", url_resolved: undefined })))
      .toBeNull();
  });
});

describe("radio directory country list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one entry per ISO country code, unchanged from the directory", () => {
    const greece = { name: "Greece", iso_3166_1: "GR", stationcount: 812 };
    const countries = deduplicateCountries([
      { name: "Greece", iso_3166_1: "GR", stationcount: 3 },
      greece,
      { name: "Greece", iso_3166_1: "gr ", stationcount: "1" },
      { name: "Georgia", iso_3166_1: "GE", stationcount: 40 },
    ]);

    expect(countries).toHaveLength(2);
    expect(countries[0]).toBe(greece);
    expect(countries[1]).toEqual({ name: "Georgia", iso_3166_1: "GE", stationcount: 40 });
  });

  it("lists each country once, alphabetically, without dropping distinct codes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { name: "India", iso_3166_1: "IN", stationcount: 900 },
      { name: "Greece", iso_3166_1: "GR", stationcount: 812 },
      { name: "Greece", iso_3166_1: "GR", stationcount: 3 },
      { name: "", iso_3166_1: "XX", stationcount: 1 },
      { name: "Germany", iso_3166_1: "DE", stationcount: 5000 },
      { name: "Congo", iso_3166_1: "CG", stationcount: 4 },
      { name: "Congo", iso_3166_1: "CD", stationcount: 9 },
    ]))));

    const countries = await radioDirectory.listCountries();

    expect(countries.map((country) => [country.name, country.iso_3166_1])).toEqual([
      ["Congo", "CG"],
      ["Congo", "CD"],
      ["Germany", "DE"],
      ["Greece", "GR"],
      ["India", "IN"],
    ]);
  });
});

describe("radio directory city list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDirectory(respond: (url: URL) => unknown) {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      return new Response(JSON.stringify(respond(url)));
    }));
    return requests;
  }

  it("builds a sorted city list without empty or duplicate names", () => {
    const cities = citiesFromStates([
      { name: "Tamil Nadu", country: "India", stationcount: 40 },
      { name: "Chennai", country: "India", stationcount: 12 },
      { name: "", country: "India", stationcount: 9 },
      { name: "   ", country: "India", stationcount: 2 },
      { name: "chennai ", country: "India", stationcount: 3 },
      { name: "Jharkhand", country: "India", stationcount: "5" },
      { name: null as unknown as string, country: "India", stationcount: 1 },
    ], "India");

    expect(cities).toEqual([
      { label: "Chennai", names: ["Chennai", "chennai "] },
      { label: "Jharkhand", names: ["Jharkhand"] },
      { label: "Tamil Nadu", names: ["Tamil Nadu"] },
    ]);
  });

  it("shows the spelling used by the most stations", () => {
    const cities = citiesFromStates([
      { name: "new  delhi", country: "India", stationcount: 1 },
      { name: "New Delhi", country: "India", stationcount: 30 },
    ], "India");

    expect(cities).toEqual([{ label: "New Delhi", names: ["new  delhi", "New Delhi"] }]);
  });

  it("keeps only the selected country's cities", () => {
    const cities = citiesFromStates([
      { name: "Punjab", country: "India", stationcount: 20 },
      { name: "Punjab", country: "Pakistan", stationcount: 15 },
      { name: "Sindh", country: "Pakistan", stationcount: 8 },
      { name: "Kerala", country: " india ", stationcount: 6 },
    ], "India");

    expect(cities.map((city) => city.label)).toEqual(["Kerala", "Punjab"]);
  });

  it("derives fallback cities from station state labels only", () => {
    const cities = citiesFromStations([
      station({ stationuuid: "a", state: "Goa" }),
      station({ stationuuid: "b", state: " goa" }),
      station({ stationuuid: "c", state: "" }),
      station({ stationuuid: "d", state: "Assam" }),
    ]);

    expect(cities).toEqual([
      { label: "Assam", names: ["Assam"] },
      { label: "Goa", names: ["Goa", " goa"] },
    ]);
  });

  it("asks the directory for every location label of the selected country", async () => {
    const requests = stubDirectory(() => [
      { name: "Utrecht", country: "The Netherlands", stationcount: 14 },
      { name: "Friesland", country: "The Netherlands", stationcount: 6 },
    ]);

    const cities = await radioDirectory.listCountryCities({ name: "The Netherlands", iso_3166_1: "NL" });

    expect(cities.map((city) => city.label)).toEqual(["Friesland", "Utrecht"]);
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe("/json/states/The%20Netherlands/");
    expect(requests[0].searchParams.get("hidebroken")).toBe("true");
    expect(requests[0].searchParams.has("limit")).toBe(false);
  });

  it("falls back to station labels when the country listing is empty", async () => {
    const requests = stubDirectory((url) =>
      url.pathname.startsWith("/json/states/")
        ? []
        : [station({ stationuuid: "a", state: "Lagos" }), station({ stationuuid: "b", state: "Abuja" })],
    );

    const cities = await radioDirectory.listCountryCities({ name: "Nigeria", iso_3166_1: "NG" });

    expect(cities.map((city) => city.label)).toEqual(["Abuja", "Lagos"]);
    expect(requests[1].pathname).toBe("/json/stations/search");
    expect(requests[1].searchParams.get("countrycode")).toBe("NG");
  });

  it("loads a city's stations by country code and exact location label", async () => {
    const requests = stubDirectory((url) =>
      url.searchParams.get("state") === "Chennai"
        ? [
            station({ stationuuid: "a", name: "Chennai One", clickcount: 5 }),
            station({ stationuuid: "b", name: "Chennai Two", clickcount: 90 }),
          ]
        : [
            station({ stationuuid: "b", name: "Chennai Two", clickcount: 90 }),
            station({ stationuuid: "c", name: "Chennai Three", clickcount: 40 }),
          ],
    );

    const stations = await radioDirectory.listCityStations("IN", { label: "Chennai", names: ["Chennai", "chennai "] });

    expect(stations.map((entry) => entry.name)).toEqual(["Chennai Two", "Chennai Three", "Chennai One"]);
    expect(requests.map((url) => url.searchParams.get("state"))).toEqual(["Chennai", "chennai "]);
    for (const url of requests) {
      expect(url.pathname).toBe("/json/stations/search");
      expect(url.searchParams.get("countrycode")).toBe("IN");
      expect(url.searchParams.get("stateExact")).toBe("true");
      expect(url.searchParams.get("is_https")).toBe("true");
      expect(url.searchParams.get("hidebroken")).toBe("true");
    }
  });
});

describe("station playability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const everything = () => true;
  const without = (...missing: string[]) => (mimeType: string) => !missing.includes(mimeType);

  it("offers the HTTPS addresses, resolved first, without duplicates or plain http", () => {
    expect(streamCandidates(station({ url_resolved: "https://a.example/live", url: "https://b.example/live" }), everything))
      .toEqual(["https://a.example/live", "https://b.example/live"]);
    expect(streamCandidates(station({ url_resolved: "https://a.example/live", url: "https://a.example/live" }), everything))
      .toEqual(["https://a.example/live"]);
    expect(streamCandidates(station({ url_resolved: "http://a.example/live", url: "https://b.example/live" }), everything))
      .toEqual(["https://b.example/live"]);
    expect(streamCandidates(station({ url_resolved: "http://a.example/live", url: "http://b.example/live" }), everything))
      .toEqual([]);
  });

  it("rules out a station the directory marks with a certificate error", () => {
    expect(isPlayableStation(station({ ssl_error: 1 }), everything)).toBe(false);
    expect(isPlayableStation(station({ ssl_error: "1" }), everything)).toBe(false);
    expect(isPlayableStation(station({ ssl_error: 0 }), everything)).toBe(true);
  });

  it("rules out HLS streams only where the browser cannot play HLS", () => {
    const noHls = without("application/vnd.apple.mpegurl");
    expect(isPlayableStation(station({ hls: 1 }), noHls)).toBe(false);
    expect(isPlayableStation(station({ hls: 1 }), everything)).toBe(true);
    expect(streamCandidates(station({ url_resolved: "https://a.example/live.m3u8?x=1", url: "https://b.example/live" }), noHls))
      .toEqual(["https://b.example/live"]);
    expect(streamCandidates(station({ url_resolved: "https://a.example/live.m3u8", url: "http://b.example/live" }), noHls))
      .toEqual([]);
  });

  it("does not offer playlist files as streams", () => {
    expect(streamCandidates(station({ url_resolved: "https://a.example/live", url: "https://a.example/listen.pls" }), everything))
      .toEqual(["https://a.example/live"]);
    expect(isPlayableStation(station({ url_resolved: "http://a.example/live", url: "https://a.example/listen.m3u" }), everything))
      .toBe(false);
  });

  it("rules out a codec the browser cannot play and leaves unknown codecs alone", () => {
    const noAac = without("audio/aac");
    expect(isPlayableStation(station({ codec: "AAC+" }), noAac)).toBe(false);
    expect(isPlayableStation(station({ codec: "aac" }), noAac)).toBe(false);
    expect(isPlayableStation(station({ codec: "MP3" }), noAac)).toBe(true);
    expect(isPlayableStation(station({ codec: "UNKNOWN" }), without("audio/mpeg", "audio/aac"))).toBe(true);
    expect(isPlayableStation(station({ codec: "" }), without("audio/mpeg", "audio/aac"))).toBe(true);
  });

  it("lists only playable stations for a city", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      station({ stationuuid: "a", name: "Plays", clickcount: 1 }),
      station({ stationuuid: "b", name: "Certificate error", ssl_error: 1, clickcount: 9 }),
      station({ stationuuid: "c", name: "Plain http", url_resolved: "http://c.example/live", clickcount: 8 }),
      station({ stationuuid: "d", name: "Playlist only", url_resolved: "http://d.example/live", url: "https://d.example/listen.pls", clickcount: 7 }),
      station({ stationuuid: "e", name: "Plays too", url_resolved: undefined, url: "https://e.example/live", clickcount: 5 }),
    ]))));

    const stations = await radioDirectory.listCityStations("IN", { label: "Chennai", names: ["Chennai"] });

    expect(stations.map((entry) => entry.name)).toEqual(["Plays too", "Plays"]);
  });
});

describe("station player", () => {
  class FakeAudio implements PlayerAudio {
    preload = "";
    volume = 1;
    currentTime = 0;
    paused = true;
    hasSource = true;
    released = false;
    rejectPlay: (reason: unknown) => void = () => {};
    private listeners: Record<string, Array<() => void>> = {};

    constructor(public url: string) {}

    play() {
      this.paused = false;
      return new Promise<void>((_resolve, reject) => {
        this.rejectPlay = reject;
      });
    }
    pause() {
      this.paused = true;
    }
    removeAttribute(name: string) {
      if (name === "src") this.hasSource = false;
    }
    load() {
      if (this.paused && !this.hasSource) this.released = true;
    }
    addEventListener(type: string, listener: () => void) {
      (this.listeners[type] ??= []).push(listener);
    }
    emit(type: string) {
      for (const listener of this.listeners[type] ?? []) listener();
    }
  }

  const twoAddresses = station({ stationuuid: "two", url_resolved: "https://resolved.example/live", url: "https://original.example/live" });
  const oneAddress = station({ stationuuid: "one", url_resolved: "https://one.example/live", url: "https://one.example/live" });
  const other = station({ stationuuid: "other", url_resolved: "https://other.example/live", url: "http://other.example/live" });
  const httpOnly = station({ stationuuid: "http", url_resolved: "http://plain.example/live", url: "http://plain.example/live" });

  function setup() {
    const audios: FakeAudio[] = [];
    const changes: string[] = [];
    const player = createStationPlayer({
      createAudio: (url) => {
        const audio = new FakeAudio(url);
        audios.push(audio);
        return audio;
      },
      onChange: (status, failure) => changes.push(failure ? `${status}:${failure}` : status),
      canPlay: () => true,
    });
    return { player, audios, changes };
  }

  // Lets a playing stream make progress for `ms`, as a healthy stream would.
  function playFor(audio: FakeAudio, ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += STALL_CHECK_MS) {
      audio.currentTime += STALL_CHECK_MS / 1000;
      vi.advanceTimersByTime(STALL_CHECK_MS);
    }
  }
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the resolved address and reports connecting, then playing", () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 0.72);

    expect(audios.map((audio) => audio.url)).toEqual(["https://resolved.example/live"]);
    expect(audios[0].volume).toBe(0.72);
    expect(audios[0].preload).toBe("none");
    expect(changes).toEqual(["connecting"]);

    audios[0].emit("playing");
    expect(changes).toEqual(["connecting", "playing"]);
  });

  it("releases the previous stream when another station is chosen", () => {
    const { player, audios } = setup();
    player.play(oneAddress, 1);
    audios[0].emit("playing");
    player.play(other, 1);

    expect(audios).toHaveLength(2);
    expect(audios[0].released).toBe(true);
    expect(audios[1].released).toBe(false);
    expect(audios[1].url).toBe("https://other.example/live");
  });

  it("releases the stream when stopped (power off, tuning away) and reports nothing", () => {
    const { player, audios, changes } = setup();
    player.play(oneAddress, 1);
    audios[0].emit("playing");
    player.stop();

    expect(audios[0].released).toBe(true);
    expect(changes).toEqual(["connecting", "playing"]);
    vi.advanceTimersByTime(10 * CONNECT_TIMEOUT_MS);
    expect(changes).toEqual(["connecting", "playing"]);
    expect(audios).toHaveLength(1);
  });

  it("reports nothing when stopped while still connecting", async () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 1);
    player.stop();
    audios[0].rejectPlay({ name: "AbortError" });
    await settle();
    vi.advanceTimersByTime(10 * CONNECT_TIMEOUT_MS);

    expect(audios[0].released).toBe(true);
    expect(changes).toEqual(["connecting"]);
    expect(audios).toHaveLength(1);
  });

  it("gives up on a stream that produces no audio within the connection timeout", () => {
    const { player, audios, changes } = setup();
    player.play(oneAddress, 1);

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(changes).toEqual(["connecting"]);
    vi.advanceTimersByTime(1);

    expect(changes).toEqual(["connecting", "error:unavailable"]);
    expect(audios[0].released).toBe(true);
    expect(audios).toHaveLength(1);
  });

  it("tries the second address when the first one fails", () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 1);
    audios[0].emit("error");

    expect(audios.map((audio) => audio.url)).toEqual(["https://resolved.example/live", "https://original.example/live"]);
    expect(audios[0].released).toBe(true);
    expect(changes).toEqual(["connecting"]);

    audios[1].emit("playing");
    expect(changes).toEqual(["connecting", "playing"]);
  });

  it("tries the second address when the first one times out, then reports unavailable", () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 1);

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(audios).toHaveLength(2);
    expect(changes).toEqual(["connecting"]);

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(changes).toEqual(["connecting", "error:unavailable"]);
    expect(audios[1].released).toBe(true);
    expect(audios).toHaveLength(2);
  });

  it("reconnects once when a playing stream ends", () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 1);
    audios[0].emit("playing");
    audios[0].emit("ended");

    expect(audios.map((audio) => audio.url)).toEqual(["https://resolved.example/live", "https://resolved.example/live"]);
    expect(audios[0].released).toBe(true);
    expect(changes).toEqual(["connecting", "playing", "connecting"]);

    audios[1].emit("playing");
    expect(changes).toEqual(["connecting", "playing", "connecting", "playing"]);
  });

  it("reconnects when a playing stream stalls", () => {
    const { player, audios, changes } = setup();
    player.play(oneAddress, 1);
    audios[0].emit("playing");
    playFor(audios[0], 20000);
    expect(changes).toEqual(["connecting", "playing"]);

    vi.advanceTimersByTime(STALL_CHECK_MS * STALL_CHECKS);

    expect(changes).toEqual(["connecting", "playing", "connecting"]);
    expect(audios[0].released).toBe(true);
    expect(audios).toHaveLength(2);
  });

  it("reports unavailable when the reconnect fails", () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 1);
    audios[0].emit("playing");
    audios[0].emit("ended");
    audios[1].emit("error");

    expect(changes).toEqual(["connecting", "playing", "connecting", "error:unavailable"]);
    expect(audios[1].released).toBe(true);
    expect(audios).toHaveLength(2);
  });

  it("reports unavailable when the reconnect times out or drops again straight away", () => {
    const first = setup();
    first.player.play(oneAddress, 1);
    first.audios[0].emit("playing");
    first.audios[0].emit("ended");
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(first.changes).toEqual(["connecting", "playing", "connecting", "error:unavailable"]);
    expect(first.audios).toHaveLength(2);

    const second = setup();
    second.player.play(oneAddress, 1);
    second.audios[0].emit("playing");
    second.audios[0].emit("ended");
    second.audios[1].emit("playing");
    second.audios[1].emit("ended");
    expect(second.changes).toEqual(["connecting", "playing", "connecting", "playing", "error:unavailable"]);
    expect(second.audios).toHaveLength(2);
  });

  it("allows a new reconnect after the reconnected stream has played steadily", () => {
    const { player, audios, changes } = setup();
    player.play(oneAddress, 1);
    audios[0].emit("playing");
    audios[0].emit("ended");
    audios[1].emit("playing");
    playFor(audios[1], STABLE_PLAYBACK_MS);
    audios[1].emit("ended");

    expect(changes).toEqual(["connecting", "playing", "connecting", "playing", "connecting"]);
    expect(audios).toHaveLength(3);
  });

  it("ignores late events from a previous station", async () => {
    const { player, audios, changes } = setup();
    player.play(oneAddress, 1);
    player.play(other, 1);

    audios[0].emit("playing");
    audios[0].emit("error");
    audios[0].emit("ended");
    audios[0].rejectPlay(new Error("network"));
    await settle();

    expect(changes).toEqual(["connecting", "connecting"]);
    expect(audios).toHaveLength(2);

    audios[1].emit("playing");
    expect(changes).toEqual(["connecting", "connecting", "playing"]);
    playFor(audios[1], 2 * CONNECT_TIMEOUT_MS);
    expect(changes).toEqual(["connecting", "connecting", "playing"]);
  });

  it("stops the previous station when the new one has no HTTPS stream", () => {
    const { player, audios, changes } = setup();
    player.play(oneAddress, 1);
    audios[0].emit("playing");
    player.play(httpOnly, 1);

    expect(audios).toHaveLength(1);
    expect(audios[0].released).toBe(true);
    expect(changes).toEqual(["connecting", "playing", "error:no-secure-stream"]);
  });

  it("reports a blocked play without trying the other address", async () => {
    const { player, audios, changes } = setup();
    player.play(twoAddresses, 1);
    audios[0].rejectPlay({ name: "NotAllowedError" });
    await settle();

    expect(changes).toEqual(["connecting", "error:blocked"]);
    expect(audios).toHaveLength(1);
    expect(audios[0].released).toBe(true);
  });

  it("applies volume changes to the current stream and to the next one", () => {
    const { player, audios } = setup();
    player.play(oneAddress, 0.72);
    player.setVolume(0.4);
    expect(audios[0].volume).toBe(0.4);

    audios[0].emit("playing");
    audios[0].emit("ended");
    expect(audios[1].volume).toBe(0.4);
  });
});

// A stand-in for the browser's storage that survives "page loads" within a test.
class FakeStorage {
  private items = new Map<string, string>();
  failWrites = false;

  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  keys() {
    return [...this.items.keys()];
  }
  chars(prefix: string) {
    return [...this.items].filter(([key]) => key.startsWith(prefix)).reduce((sum, [, value]) => sum + value.length, 0);
  }
}

const INDIA = { name: "India", iso_3166_1: "IN" };
const GREECE = { name: "Greece", iso_3166_1: "GR" };
const CHENNAI = { label: "Chennai", names: ["Chennai"] };
const kind = (url: URL) =>
  url.pathname === "/json/countries"
    ? "countries"
    : url.pathname.startsWith("/json/states/")
      ? `cities ${decodeURIComponent(url.pathname.split("/")[3])}`
      : url.searchParams.has("geo_lat")
        ? `near ${url.searchParams.get("geo_lat")},${url.searchParams.get("geo_long")} within ${Number(url.searchParams.get("geo_distance")) / 1000} km`
        : `stations ${url.searchParams.get("countrycode")}/${url.searchParams.get("state") ?? "*"}`;

// Answers every directory request at once.
function answerDirectory(respond: (url: URL) => unknown) {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    requests.push(kind(url));
    const body = respond(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body));
  }));
  return requests;
}

// Leaves every directory request waiting until the test answers it, and notices cancellation.
function holdDirectory() {
  const waiting: Array<{ kind: string; signal?: AbortSignal | null; answer: (body: unknown) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted.", "AbortError")));
      waiting.push({ kind: kind(new URL(input)), signal: init?.signal, answer: (body) => resolve(new Response(JSON.stringify(body))) });
    }),
  ));
  return waiting;
}

// Lets every already-answered request finish and be reported.
const settle = async () => {
  for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
};
const statesOf = (country: string, ...names: string[]) => names.map((name) => ({ name, country, stationcount: 5 }));
const directoryAnswers = (url: URL): unknown => {
  if (url.pathname === "/json/countries") {
    return [
      { name: "India", iso_3166_1: "IN", stationcount: 900 },
      { name: "Greece", iso_3166_1: "GR", stationcount: 812 },
      { name: "Greece", iso_3166_1: "GR", stationcount: 3 },
    ];
  }
  if (url.pathname.startsWith("/json/states/India")) return statesOf("India", "Chennai", "Assam");
  if (url.pathname.startsWith("/json/states/Greece")) return statesOf("Greece", "Attica");
  if (url.pathname.startsWith("/json/states/")) return [];
  return [
    station({ stationuuid: "a", name: "Plays", clickcount: 1 }),
    station({ stationuuid: "b", name: "Certificate error", ssl_error: 1, clickcount: 9 }),
  ];
};

describe("directory cache", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the country list for 24 hours, also across page loads", async () => {
    const requests = answerDirectory(directoryAnswers);

    const first = await radioDirectory.listCountries();
    expect(first.map((country) => country.name)).toEqual(["Greece", "India"]);
    expect(await radioDirectory.listCountries()).toEqual(first);
    expect(requests).toEqual(["countries"]);

    resetDirectoryMemory(); // the page is opened again
    expect(await radioDirectory.listCountries()).toEqual(first);
    expect(requests).toEqual(["countries"]);

    vi.advanceTimersByTime(DIRECTORY_CACHE_TTL_MS - 1);
    await radioDirectory.listCountries();
    expect(requests).toEqual(["countries"]);

    vi.advanceTimersByTime(1);
    await radioDirectory.listCountries();
    expect(requests).toEqual(["countries", "countries"]);
  });

  it("keeps a country's city list for 24 hours, also across page loads", async () => {
    const requests = answerDirectory(directoryAnswers);

    expect(radioDirectory.peekCountryCities(INDIA)).toBeUndefined();
    const first = await radioDirectory.listCountryCities(INDIA);
    expect(first.map((city) => city.label)).toEqual(["Assam", "Chennai"]);
    expect(radioDirectory.peekCountryCities(INDIA)).toEqual(first);
    await radioDirectory.listCountryCities(INDIA);
    expect(requests).toEqual(["cities India"]);

    resetDirectoryMemory();
    expect(radioDirectory.peekCountryCities(INDIA)).toEqual(first);
    expect(await radioDirectory.listCountryCities(INDIA)).toEqual(first);
    expect(radioDirectory.peekCountryCities(GREECE)).toBeUndefined();
    expect(requests).toEqual(["cities India"]);
  });

  it("drops expired entries and asks the directory again", async () => {
    const requests = answerDirectory(directoryAnswers);
    await radioDirectory.listCountryCities(INDIA);
    expect(storage.keys()).toEqual(["radio-directory:1:cities2:IN"]);

    vi.advanceTimersByTime(DIRECTORY_CACHE_TTL_MS);
    expect(radioDirectory.peekCountryCities(INDIA)).toBeUndefined();
    expect(storage.keys()).toEqual([]);

    await radioDirectory.listCountryCities(INDIA);
    expect(requests).toEqual(["cities India", "cities India"]);
    expect(storage.keys()).toEqual(["radio-directory:1:cities2:IN"]);

    resetDirectoryMemory();
    vi.advanceTimersByTime(DIRECTORY_CACHE_TTL_MS);
    expect(radioDirectory.peekCountryCities(INDIA)).toBeUndefined();
    expect(storage.keys()).toEqual([]);
  });

  it("ignores and removes a stored entry it cannot read", async () => {
    storage.setItem("radio-directory:1:countries", `${Date.now()}\n{not json`);
    storage.setItem("radio-directory:1:cities2:IN", "nonsense");
    const requests = answerDirectory(directoryAnswers);

    expect(radioDirectory.peekCountryCities(INDIA)).toBeUndefined();
    expect((await radioDirectory.listCountries()).map((country) => country.name)).toEqual(["Greece", "India"]);
    expect(requests).toEqual(["countries"]);
    expect(storage.keys()).toEqual(["radio-directory:1:countries"]);
  });

  it("keeps the fallback city list for the current page only", async () => {
    const requests = answerDirectory((url) =>
      url.pathname.startsWith("/json/states/") ? [] : [station({ stationuuid: "a", state: "Lagos" })],
    );
    const nigeria = { name: "Nigeria", iso_3166_1: "NG" };

    expect((await radioDirectory.listCountryCities(nigeria)).map((city) => city.label)).toEqual(["Lagos"]);
    await radioDirectory.listCountryCities(nigeria);
    expect(requests).toEqual(["cities Nigeria", "stations NG/*"]);
    expect(storage.keys()).toEqual([]);

    resetDirectoryMemory();
    await radioDirectory.listCountryCities(nigeria);
    expect(requests).toEqual(["cities Nigeria", "stations NG/*", "cities Nigeria", "stations NG/*"]);
  });

  it("keeps station lists in memory for the page only and filters them on every read", async () => {
    const requests = answerDirectory(directoryAnswers);

    const first = await radioDirectory.listCityStations("IN", CHENNAI);
    const second = await radioDirectory.listCityStations("IN", CHENNAI);
    expect(first.map((entry) => entry.name)).toEqual(["Plays"]);
    expect(second).toEqual(first);
    expect(requests).toEqual(["stations IN/Chennai"]);
    expect(storage.keys()).toEqual([]);

    resetDirectoryMemory(); // station lists do not survive a page load
    await radioDirectory.listCityStations("IN", CHENNAI);
    expect(requests).toEqual(["stations IN/Chennai", "stations IN/Chennai"]);
  });

  it("limits how many stations are kept in memory, dropping the least recently used city", async () => {
    const perCity = 500;
    const requests = answerDirectory((url) =>
      Array.from({ length: perCity }, (_unused, index) =>
        station({ stationuuid: `${url.searchParams.get("state")}-${index}`, name: `${url.searchParams.get("state")} ${index}` }),
      ),
    );
    const cities = Array.from({ length: STATION_CACHE_MAX_STATIONS / perCity + 1 }, (_unused, index) => ({
      label: `City ${index}`,
      names: [`City ${index}`],
    }));

    for (const city of cities.slice(0, -1)) await radioDirectory.listCityStations("IN", city);
    await radioDirectory.listCityStations("IN", cities[0]); // used again: no longer the oldest
    expect(requests).toHaveLength(cities.length - 1);

    await radioDirectory.listCityStations("IN", cities[cities.length - 1]); // one city too many
    await radioDirectory.listCityStations("IN", cities[0]);
    expect(requests).toHaveLength(cities.length);

    await radioDirectory.listCityStations("IN", cities[1]); // the least recently used one was dropped
    expect(requests).toHaveLength(cities.length + 1);
  });

  it("limits how much city data is stored, dropping the oldest lists", async () => {
    answerDirectory((url) => {
      const country = decodeURIComponent(url.pathname.split("/")[3]);
      return Array.from({ length: 2500 }, (_unused, index) => ({ name: `Place ${index} ${"x".repeat(45)}`, country, stationcount: 1 }));
    });

    for (let index = 0; index < 6; index += 1) {
      await radioDirectory.listCountryCities({ name: `Country ${index}`, iso_3166_1: `C${index}` });
      vi.advanceTimersByTime(60_000);
    }

    expect(storage.chars("radio-directory:1:cities2:")).toBeLessThanOrEqual(CITY_STORAGE_MAX_CHARS);
    expect(storage.keys()).toContain("radio-directory:1:cities2:C5");
    expect(storage.keys()).not.toContain("radio-directory:1:cities2:C0");
    expect(radioDirectory.peekCountryCities({ iso_3166_1: "C0" })).toBeDefined(); // still in memory for this page
  });

  it("keeps working when the browser's storage is full", async () => {
    storage.failWrites = true;
    const requests = answerDirectory(directoryAnswers);

    await radioDirectory.listCountries();
    await radioDirectory.listCountries();
    await radioDirectory.listCountryCities(INDIA);
    expect(radioDirectory.peekCountryCities(INDIA)).toBeDefined();
    expect(requests).toEqual(["countries", "cities India"]);
    expect(storage.keys()).toEqual([]);
  });

  it("shares an identical request that is already on its way", async () => {
    const waiting = holdDirectory();

    const one = radioDirectory.listCityStations("IN", CHENNAI);
    const two = radioDirectory.listCityStations("IN", CHENNAI);
    const other = radioDirectory.listCityStations("IN", { label: "Assam", names: ["Assam"] });
    await settle();
    expect(waiting.map((request) => request.kind)).toEqual(["stations IN/Chennai", "stations IN/Assam"]);

    waiting[0].answer([station({ stationuuid: "a", name: "Plays" })]);
    waiting[1].answer([]);
    expect((await one).map((entry) => entry.name)).toEqual(["Plays"]);
    expect(await two).toEqual(await one);
    expect(await other).toEqual([]);
  });

  it("uses the country list started at page open when SEARCH needs it", async () => {
    const waiting = holdDirectory();

    const atPageOpen = radioDirectory.listCountries();
    const whenSearchOpens = radioDirectory.listCountries();
    await settle();
    expect(waiting.map((request) => request.kind)).toEqual(["countries"]);

    waiting[0].answer([{ name: "India", iso_3166_1: "IN", stationcount: 900 }]);
    expect(await whenSearchOpens).toEqual(await atPageOpen);
    expect((await radioDirectory.listCountries()).map((country) => country.name)).toEqual(["India"]);
    expect(waiting).toHaveLength(1);
  });

  it("cancels a request once nobody is waiting for it", async () => {
    const waiting = holdDirectory();
    const caller = new AbortController();

    const request = radioDirectory.listCityStations("IN", CHENNAI, caller.signal);
    await settle();
    expect(waiting[0].signal?.aborted).toBe(false);

    caller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(waiting[0].signal?.aborted).toBe(true);

    void radioDirectory.listCityStations("IN", CHENNAI); // nothing was kept from the cancelled request
    await settle();
    expect(waiting).toHaveLength(2);
  });

  it("keeps a shared request running, and its result, while someone still waits", async () => {
    const waiting = holdDirectory();
    const leaves = new AbortController();
    const stays = new AbortController();

    const left = radioDirectory.listCountryCities(INDIA, leaves.signal);
    const stayed = radioDirectory.listCountryCities(INDIA, stays.signal);
    await settle();
    leaves.abort();
    await expect(left).rejects.toMatchObject({ name: "AbortError" });
    expect(waiting).toHaveLength(1);
    expect(waiting[0].signal?.aborted).toBe(false);

    waiting[0].answer(statesOf("India", "Chennai"));
    expect((await stayed).map((city) => city.label)).toEqual(["Chennai"]);
    expect(radioDirectory.peekCountryCities(INDIA)).toEqual(await stayed);
  });

  it("keeps a finished response even when nobody uses it any more", async () => {
    const waiting = holdDirectory();

    void radioDirectory.listCountryCities(INDIA).catch(() => {}); // asked for, then the screen was left
    await settle();
    waiting[0].answer(statesOf("India", "Chennai"));
    await settle();

    expect(radioDirectory.peekCountryCities(INDIA)?.map((city) => city.label)).toEqual(["Chennai"]);
    await radioDirectory.listCountryCities(INDIA);
    expect(waiting).toHaveLength(1);
  });
});

describe("city list loader", () => {
  let reports: string[];
  const describeReport = (result: CityListReport) =>
    result.status === "ready" ? `ready:${result.cities.map((city) => city.label).join(",")}` : result.status;
  const newLoader = () => createCityListLoader((result) => reports.push(describeReport(result)));

  beforeEach(() => {
    reports = [];
    vi.stubGlobal("localStorage", new FakeStorage());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks at once for a country chosen by touch", async () => {
    const requests = answerDirectory(directoryAnswers);
    newLoader().load(INDIA);
    expect(reports).toEqual(["loading"]);
    expect(requests).toEqual(["cities India"]);

    await settle();
    expect(reports).toEqual(["loading", "ready:Assam,Chennai"]);
  });

  it("waits until the knob has rested for 300 ms before asking", async () => {
    const requests = answerDirectory(directoryAnswers);
    expect(KNOB_SETTLE_MS).toBe(300);
    newLoader().load(INDIA, KNOB_SETTLE_MS);
    expect(reports).toEqual(["loading"]);

    vi.advanceTimersByTime(KNOB_SETTLE_MS - 1);
    expect(requests).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(requests).toEqual(["cities India"]);

    await settle();
    expect(reports).toEqual(["loading", "ready:Assam,Chennai"]);
  });

  it("asks only for the last country when the knob passes over several", async () => {
    const requests = answerDirectory(directoryAnswers);
    const loader = newLoader();
    const passedOver = ["Albania", "Algeria", "Angola", "Argentina", "Armenia"].map((name, index) => ({ name, iso_3166_1: `A${index}` }));

    for (const country of passedOver) {
      loader.load(country, KNOB_SETTLE_MS);
      vi.advanceTimersByTime(80);
    }
    loader.load(GREECE, KNOB_SETTLE_MS);
    vi.advanceTimersByTime(KNOB_SETTLE_MS - 1);
    expect(requests).toEqual([]);

    vi.advanceTimersByTime(1);
    await settle();
    expect(requests).toEqual(["cities Greece"]);
    expect(reports.filter((entry) => entry !== "loading")).toEqual(["ready:Attica"]);
  });

  it("shows a known city list at once, without waiting and without a request", async () => {
    const requests = answerDirectory(directoryAnswers);
    await radioDirectory.listCountryCities(INDIA);
    requests.length = 0;

    newLoader().load(INDIA, KNOB_SETTLE_MS);
    expect(reports).toEqual(["ready:Assam,Chennai"]);

    vi.advanceTimersByTime(10 * KNOB_SETTLE_MS);
    await settle();
    expect(requests).toEqual([]);
    expect(reports).toEqual(["ready:Assam,Chennai"]);
  });

  it("cancels the request for a country that a newer choice replaced", async () => {
    const waiting = holdDirectory();
    const loader = newLoader();

    loader.load(INDIA);
    await settle();
    loader.load(GREECE);
    await settle();
    expect(waiting.map((request) => request.kind)).toEqual(["cities India", "cities Greece"]);
    expect(waiting[0].signal?.aborted).toBe(true);
    expect(waiting[1].signal?.aborted).toBe(false);

    waiting[1].answer(statesOf("Greece", "Attica"));
    await settle();
    expect(reports).toEqual(["loading", "loading", "ready:Attica"]);
    expect(radioDirectory.peekCountryCities(INDIA)).toBeUndefined();
  });

  it("does not start again for a country whose list is already on its way", async () => {
    const waiting = holdDirectory();
    const loader = newLoader();

    loader.load(INDIA);
    loader.load(INDIA); // for example: SEARCH was left and opened again
    await settle();
    expect(waiting).toHaveLength(1);
    expect(reports).toEqual(["loading"]);

    waiting[0].answer(statesOf("India", "Chennai"));
    await settle();
    loader.load(INDIA);
    expect(reports).toEqual(["loading", "ready:Chennai", "ready:Chennai"]);
    expect(waiting).toHaveLength(1);
  });

  it("does not ask at all when the choice is dropped before the knob has settled", async () => {
    const requests = answerDirectory(directoryAnswers);
    const loader = newLoader();

    loader.load(INDIA, KNOB_SETTLE_MS);
    vi.advanceTimersByTime(100);
    loader.cancel();
    vi.advanceTimersByTime(10 * KNOB_SETTLE_MS);
    await settle();

    expect(requests).toEqual([]);
    expect(reports).toEqual(["loading"]);
  });

  it("reports a failed load and tries again when asked again", async () => {
    let fail = true;
    const requests = answerDirectory((url) => (fail ? new Error("offline") : directoryAnswers(url)));
    const loader = newLoader();

    loader.load(INDIA);
    await settle();
    expect(reports).toEqual(["loading", "error"]);
    expect(requests).toEqual(["cities India", "stations IN/*"]);

    fail = false;
    loader.load(INDIA);
    await settle();
    expect(reports).toEqual(["loading", "error", "loading", "ready:Assam,Chennai"]);
  });
});

// ---------------------------------------------------------------------------
// Automatic local station

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };
const geoStation = (id: string, countrycode: string, state: string, lat: number, long: number, clickcount: number, extra: Partial<RadioStation> = {}) =>
  station({ stationuuid: id, name: `Station ${id}`, countrycode, state, geo_lat: lat, geo_long: long, clickcount, ...extra });
// Geo-tagged stations in and around Bengaluru, as a "stations near this point" answer.
const AROUND_BENGALURU = [
  geoStation("blr-1", "IN", "Karnataka", 12.97, 77.59, 400),
  geoStation("blr-2", "IN", "karnataka ", 12.93, 77.62, 120),
  geoStation("blr-3", "IN", "Bengaluru", 12.99, 77.57, 60),
  geoStation("hosur", "IN", "Tamil Nadu", 12.74, 77.83, 9000),
];
const KARNATAKA_STATIONS = [
  station({ stationuuid: "ka-top", name: "Most Popular", countrycode: "IN", state: "Karnataka", clickcount: 900 }),
  station({ stationuuid: "ka-fm", name: "Radio City 91.1 FM", countrycode: "IN", state: "Karnataka", clickcount: 700 }),
  station({ stationuuid: "ka-broken", name: "Certificate error 98.3 FM", countrycode: "IN", state: "Karnataka", clickcount: 5000, ssl_error: 1 }),
  station({ stationuuid: "ka-low", name: "Small 104.0 FM", countrycode: "IN", state: "Karnataka", clickcount: 3 }),
];
const INDIA_TOP = [
  station({ stationuuid: "in-1", name: "National Hit", countrycode: "IN", state: "Maharashtra", clickcount: 50000 }),
  station({ stationuuid: "in-2", name: "Second", countrycode: "IN", state: "Karnataka", clickcount: 40000 }),
];
const MAHARASHTRA_STATIONS = [
  station({ stationuuid: "in-1", name: "National Hit", countrycode: "IN", state: "Maharashtra", clickcount: 50000 }),
  station({ stationuuid: "mh-fm", name: "Mumbai 93.5 FM", countrycode: "IN", state: "Maharashtra", clickcount: 800 }),
];
const zonesOf = (code: string) => ({ IN: ["Asia/Kolkata"], GR: ["Europe/Athens"], DE: ["Europe/Berlin", "Europe/Busingen"] })[code] ?? [];

// The directory as the location tests see it; `overrides` replaces single answers.
const localDirectory = (overrides: (url: URL) => unknown = () => undefined) => (url: URL): unknown => {
  const special = overrides(url);
  if (special !== undefined) return special;
  if (url.pathname === "/json/countries") {
    return [
      { name: "India", iso_3166_1: "IN", stationcount: 900 },
      { name: "Greece", iso_3166_1: "GR", stationcount: 800 },
      { name: "Germany", iso_3166_1: "DE", stationcount: 5000 },
    ];
  }
  if (url.pathname.startsWith("/json/states/India")) return statesOf("India", "Karnataka", "Tamil Nadu", "Maharashtra", "Bengaluru");
  if (url.pathname.startsWith("/json/states/Greece")) return statesOf("Greece", "Attica");
  if (url.pathname.startsWith("/json/states/")) return [];
  if (url.searchParams.has("geo_lat")) return Number(url.searchParams.get("geo_distance")) >= 100000 ? AROUND_BENGALURU : [];
  const state = url.searchParams.get("state");
  if (url.searchParams.get("countrycode") === "IN") {
    if (state === "Karnataka" || state === "karnataka ") return KARNATAKA_STATIONS;
    if (state === "Maharashtra") return MAHARASHTRA_STATIONS;
    if (state === null) return INDIA_TOP;
  }
  return [];
};

// A stand-in for the browser's location feature. "silent" never answers (an open prompt).
function fakeGeolocation(answer: { latitude: number; longitude: number } | { code: number } | "silent") {
  const asked: Array<{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number } | undefined> = [];
  let late: { ok: (position: { coords: { latitude: number; longitude: number } }) => void; fail?: (error: { code: number }) => void } | undefined;
  const geolocation: GeolocationLike = {
    getCurrentPosition(ok, fail, options) {
      asked.push(options);
      late = { ok, fail };
      if (answer === "silent") return;
      void Promise.resolve().then(() => ("code" in answer ? fail?.(answer) : ok({ coords: answer })));
    },
  };
  return { geolocation, asked, allowLater: (coords: { latitude: number; longitude: number }) => late?.ok({ coords }), denyLater: () => late?.fail?.({ code: 1 }) };
}

describe("automatic local station: choosing", () => {
  it("rounds coordinates to one decimal place (about 11 km)", () => {
    expect(roundCoordinate(12.9716)).toBe(13);
    expect(roundCoordinate(77.5946)).toBe(77.6);
    expect(roundCoordinate(12.94)).toBe(12.9);
    expect(roundCoordinate(-33.8688)).toBe(-33.9);
    expect(Object.is(roundCoordinate(-0.04), 0)).toBe(true);
  });

  it("measures distances and keeps only stations that really are within the radius, nearest first", () => {
    expect(Math.round(distanceKm(12.9716, 77.5946, 13.0827, 80.2707))).toBeGreaterThan(280);
    expect(Math.round(distanceKm(12.9716, 77.5946, 13.0827, 80.2707))).toBeLessThan(300);
    expect(distanceKm(10, 20, 10, 20)).toBe(0);

    const nearby = stationsWithinKm(
      [
        geoStation("delhi", "IN", "Delhi", 28.61, 77.21, 99999),
        geoStation("far-side", "IN", "Karnataka", 12.3, 76.65, 10),
        geoStation("close", "IN", "Karnataka", 12.98, 77.6, 10),
        station({ stationuuid: "no-coordinates", countrycode: "IN", state: "Karnataka" }),
        station({ stationuuid: "null-coordinates", countrycode: "IN", state: "Karnataka", geo_lat: null, geo_long: null }),
      ],
      13,
      77.6,
      150,
    );
    expect(nearby.map((entry) => entry.station.stationuuid)).toEqual(["close", "far-side"]);
    expect(nearby[0].km).toBeLessThan(5);
  });

  it("takes the country and the city labels from the stations around the listener", () => {
    const place = resolveLocalPlace(stationsWithinKm(AROUND_BENGALURU, 13, 77.6, 100));
    expect(place?.countryCode).toBe("IN");
    // Spellings of one label count together; a station next door outweighs a far more popular one 40 km away.
    expect(place?.labels).toEqual(["Karnataka", "Bengaluru", "Tamil Nadu"]);
  });

  it("picks the country most of the nearby stations are in, and ignores stations that cannot be played", () => {
    const nearBorder = stationsWithinKm(
      [
        geoStation("gr-1", "GR", "Attica", 38.0, 23.7, 50),
        geoStation("gr-2", "gr", "Attica", 38.02, 23.72, 50),
        geoStation("other", "IN", "Karnataka", 38.01, 23.71, 60),
        geoStation("broken", "IN", "Karnataka", 38.0, 23.7, 99999, { ssl_error: 1 }),
        geoStation("http-only", "IN", "Karnataka", 38.0, 23.7, 99999, { url: "http://x.example/a", url_resolved: "http://x.example/a" }),
      ],
      38,
      23.7,
      100,
    );
    expect(resolveLocalPlace(nearBorder)).toEqual({ countryCode: "GR", labels: ["Attica"] });
    expect(resolveLocalPlace([])).toBeNull();
    expect(resolveLocalPlace(stationsWithinKm([geoStation("no-label", "IN", " ", 13, 77.6, 5)], 13, 77.6, 100))).toEqual({ countryCode: "IN", labels: [] });
  });

  it("finds a label in the country's city list under any of its spellings", () => {
    const cities = [{ label: "Karnataka", names: ["Karnataka", "karnataka "] }, { label: "Tamil Nadu", names: ["Tamil Nadu"] }];
    expect(findCity(cities, " KARNATAKA")?.label).toBe("Karnataka");
    expect(findCity(cities, "tamil  nadu")?.label).toBe("Tamil Nadu");
    expect(findCity(cities, "Kerala")).toBeUndefined();
    expect(findCity(cities, "")).toBeUndefined();
  });

  it("selects the most popular playable station, preferring one with an FM frequency among the top candidates", () => {
    // The unplayable station is never chosen, however popular; the FM station beats the more popular one.
    expect(pickLocalStation(KARNATAKA_STATIONS)?.stationuuid).toBe("ka-fm");
    // No frequency anywhere: simply the most popular.
    const plain = [station({ stationuuid: "a", clickcount: 5 }), station({ stationuuid: "b", clickcount: 50 }), station({ stationuuid: "c" })];
    expect(pickLocalStation(plain)?.stationuuid).toBe("b");
    // A frequency outside the top candidates does not win.
    const many = Array.from({ length: FREQUENCY_PREFERENCE_TOP }, (_, index) => station({ stationuuid: `p${index}`, name: `Popular ${index}`, clickcount: 1000 - index }));
    expect(FREQUENCY_PREFERENCE_TOP).toBe(10);
    expect(pickLocalStation([...many, station({ stationuuid: "fm", name: "Late 101.5 FM", clickcount: 1 })])?.stationuuid).toBe("p0");
    expect(pickLocalStation([...many.slice(1), station({ stationuuid: "fm", name: "Late 101.5 FM", clickcount: 1 })])?.stationuuid).toBe("fm");
    // Nothing playable: nothing is chosen.
    expect(pickLocalStation([station({ ssl_error: 1 }), station({ url: "http://a.example/s", url_resolved: undefined })])).toBeNull();
    expect(pickLocalStation([])).toBeNull();
    // A browser that cannot play the stations' format has nothing to choose from.
    expect(pickLocalStation(KARNATAKA_STATIONS.map((entry) => ({ ...entry, codec: "MP3" })), () => false)).toBeNull();
  });

  it("finds the country from the device's time zone, without a table", () => {
    const codes = ["IN", "GR", "DE", "gr"];
    expect(countryFromTimeZone(codes, "Asia/Kolkata", zonesOf)).toBe("IN");
    // Browsers spell some zones differently.
    expect(countryFromTimeZone(codes, "Asia/Calcutta", zonesOf)).toBe("IN");
    expect(countryFromTimeZone(codes, "Asia/Kolkata", (code) => (code === "IN" ? ["Asia/Calcutta"] : []))).toBe("IN");
    expect(countryFromTimeZone(codes, "Europe/Busingen", zonesOf)).toBe("DE");
    expect(countryFromTimeZone(codes, "Pacific/Auckland", zonesOf)).toBeNull();
    expect(countryFromTimeZone(codes, "", zonesOf)).toBeNull(); // the browser gives no time zone
    expect(countryFromTimeZone(["IN", "GR"], "Asia/Kolkata", () => ["Asia/Kolkata"])).toBeNull(); // two countries fit
    expect(countryFromTimeZone(["not a code"], "Asia/Kolkata", () => ["Asia/Kolkata"])).toBeNull();
    // With the platform's own data (no injected table).
    expect(countryFromTimeZone(["IN", "GR", "DE", "US"], "Europe/Berlin")).toBe("DE");
    expect(countryFromTimeZone(["IN", "GR", "DE", "US"], "Asia/Kolkata")).toBe("IN");
  });
});

describe("automatic local station: tuner", () => {
  let storage: FakeStorage;
  let tuned: LocalTuneResult[];
  let fetched: string[];
  const describeTuned = () => tuned.map((result) => `${result.source}:${result.country.iso_3166_1}/${result.city?.label ?? "-"}/${result.station.stationuuid}`);
  const newTuner = (geolocation: GeolocationLike | null, extra: Partial<Parameters<typeof createLocationTuner>[0]> = {}): LocationTuner =>
    createLocationTuner({ onTuned: (result) => tuned.push(result), geolocation, permissions: null, storage, timeZone: "Asia/Kolkata", zonesOf, ...extra });
  // Answers the directory and also keeps every full address that was requested.
  const answer = (respond: (url: URL) => unknown = localDirectory()) => {
    const requests = answerDirectory((url) => {
      fetched.push(url.toString());
      return respond(url);
    });
    return requests;
  };
  const newPage = () => resetDirectoryMemory();
  // A browser that has never opened the radio.
  const newBrowser = () => {
    storage = new FakeStorage();
    vi.stubGlobal("localStorage", storage);
    resetDirectoryMemory();
  };

  beforeEach(() => {
    storage = new FakeStorage();
    tuned = [];
    fetched = [];
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T08:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("finds the listener's city and its best station from their position", async () => {
    const requests = answer();
    const location = fakeGeolocation(BENGALURU);
    newTuner(location.geolocation).start();
    await settle();

    expect(describeTuned()).toEqual(["location:IN/Karnataka/ka-fm"]);
    expect(requests).toEqual([
      "countries",
      "near 13,77.6 within 100 km",
      "cities India",
      "stations IN/Karnataka",
    ]);
    // The station list handed over is the city's playable stations, most popular first.
    expect(tuned[0].stations.map((entry) => entry.stationuuid)).toEqual(["ka-top", "ka-fm", "ka-low"]);
    expect(tuned[0].cities.map((city) => city.label)).toEqual(["Bengaluru", "Karnataka", "Maharashtra", "Tamil Nadu"]);
    // The browser is asked once, for a coarse position, with a time limit.
    expect(location.asked).toEqual([{ enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: LOCATION_MAX_AGE_MS }]);
    expect(LOCATION_TIMEOUT_MS).toBe(10000);
  });

  it("sends only a rounded point to the directory and stores no coordinates", async () => {
    answer();
    newTuner(fakeGeolocation(BENGALURU).geolocation).start();
    await settle();

    const nearby = new URL(fetched.find((address) => address.includes("geo_lat"))!);
    expect(Object.fromEntries(nearby.searchParams)).toEqual({
      geo_lat: "13",
      geo_long: "77.6",
      geo_distance: "100000",
      has_geo_info: "true",
      hidebroken: "true",
      is_https: "true",
      limit: String(NEARBY_STATION_LIMIT),
      order: "clickcount",
      reverse: "true",
    });
    for (const text of [...fetched, ...storage.keys().map((key) => `${key}=${storage.getItem(key)}`)]) {
      expect(text).not.toMatch(/12\.97|77\.59/);
    }
    // Only the country, the city label and the time are remembered.
    expect(JSON.parse(storage.getItem("radio-location:1:place")!)).toEqual({ savedAt: Date.now(), countryCode: "IN", cityLabel: "Karnataka" });
    expect(storage.getItem("radio-location:1:declined")).toBeNull();
  });

  it("looks once more in a wider circle when nothing is found nearby", async () => {
    expect(NEARBY_RADII_KM).toEqual([100, 300]);
    const requests = answer(localDirectory((url) => (url.searchParams.has("geo_lat") ? (url.searchParams.get("geo_distance") === "300000" ? AROUND_BENGALURU : []) : undefined)));
    newTuner(fakeGeolocation(BENGALURU).geolocation).start();
    await settle();

    expect(requests.slice(0, 3)).toEqual(["countries", "near 13,77.6 within 100 km", "near 13,77.6 within 300 km"]);
    expect(describeTuned()).toEqual(["location:IN/Karnataka/ka-fm"]);
  });

  it("remembers the place for 24 hours, without asking the browser or searching nearby again", async () => {
    answer();
    newTuner(fakeGeolocation(BENGALURU).geolocation).start();
    await settle();
    expect(describeTuned()).toEqual(["location:IN/Karnataka/ka-fm"]);

    // A later page load, just under 24 hours on.
    vi.setSystemTime(Date.now() + LOCAL_PLACE_TTL_MS - 1000);
    newPage();
    const later = answer();
    const second = fakeGeolocation(BENGALURU);
    newTuner(second.geolocation).start();
    await settle();
    expect(second.asked).toEqual([]);
    expect(later.some((request) => request.startsWith("near"))).toBe(false);
    expect(describeTuned()[1]).toBe("remembered:IN/Karnataka/ka-fm");

    // After 24 hours the place is found afresh.
    expect(LOCAL_PLACE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    vi.setSystemTime(Date.now() + 2000);
    newPage();
    const afterwards = answer();
    const third = fakeGeolocation(BENGALURU);
    newTuner(third.geolocation).start();
    await settle();
    expect(third.asked).toHaveLength(1);
    expect(afterwards).toContain("near 13,77.6 within 100 km");
    expect(describeTuned()[2]).toBe("location:IN/Karnataka/ka-fm");
  });

  it("falls back to the time-zone country when permission is denied, and remembers the denial for 7 days", async () => {
    const requests = answer();
    const denied = fakeGeolocation({ code: 1 });
    newTuner(denied.geolocation).start();
    await settle();

    expect(denied.asked).toHaveLength(1);
    // No position: no nearby search. The country's most popular station, with that station's city.
    expect(requests).toEqual(["countries", "stations IN/*", "cities India", "stations IN/Maharashtra"]);
    expect(new URL(fetched[1]).searchParams.get("limit")).toBe(String(COUNTRY_FALLBACK_LIMIT));
    expect(describeTuned()).toEqual(["country:IN/Maharashtra/mh-fm"]);
    expect(storage.getItem("radio-location:1:declined")).toBe(String(Date.now()));
    expect(storage.getItem("radio-location:1:place")).toBeNull(); // a fallback is not remembered as the listener's place

    // Within 7 days the browser is not asked again.
    expect(LOCATION_DENIAL_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    vi.setSystemTime(Date.now() + LOCATION_DENIAL_TTL_MS - 1000);
    newPage();
    answer();
    const again = fakeGeolocation(BENGALURU);
    newTuner(again.geolocation).start();
    await settle();
    expect(again.asked).toEqual([]);
    expect(describeTuned()[1]).toBe("country:IN/Maharashtra/mh-fm");

    // After 7 days it is asked again.
    vi.setSystemTime(Date.now() + 2000);
    newPage();
    answer();
    const afterAWeek = fakeGeolocation(BENGALURU);
    newTuner(afterAWeek.geolocation).start();
    await settle();
    expect(afterAWeek.asked).toHaveLength(1);
    expect(describeTuned()[2]).toBe("location:IN/Karnataka/ka-fm");
    expect(storage.getItem("radio-location:1:declined")).toBeNull();
  });

  it("does not ask a browser that already holds a denial", async () => {
    answer();
    const location = fakeGeolocation(BENGALURU);
    newTuner(location.geolocation, { permissions: { query: async () => ({ state: "denied" }) } }).start();
    await settle();
    expect(location.asked).toEqual([]);
    expect(describeTuned()).toEqual(["country:IN/Maharashtra/mh-fm"]);
    expect(storage.getItem("radio-location:1:declined")).toBeNull();

    // "prompt" and "granted" do ask; so does a browser whose permission cannot be read.
    for (const permissions of [{ query: async () => ({ state: "prompt" }) }, { query: async () => ({ state: "granted" }) }, { query: async () => Promise.reject(new TypeError("not supported")) }]) {
      newBrowser();
      answer();
      const asked = fakeGeolocation(BENGALURU);
      newTuner(asked.geolocation, { permissions }).start();
      await settle();
      expect(asked.asked).toHaveLength(1);
    }
  });

  it("falls back to the time-zone country when the location times out or is unavailable, without remembering a denial", async () => {
    // A prompt nobody answers: our own time limit ends the wait.
    const requests = answer();
    const silent = fakeGeolocation("silent");
    newTuner(silent.geolocation).start();
    await settle();
    expect(requests).toEqual(["countries"]);
    expect(tuned).toEqual([]);
    vi.advanceTimersByTime(LOCATION_WAIT_MS - 1);
    await settle();
    expect(tuned).toEqual([]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(describeTuned()).toEqual(["country:IN/Maharashtra/mh-fm"]);
    expect(storage.getItem("radio-location:1:declined")).toBeNull();
    // An answer that comes after the limit changes nothing.
    silent.allowLater(BENGALURU);
    await settle();
    expect(tuned).toHaveLength(1);

    // The browser's own "timed out" (3) and "position unavailable" (2), and no location feature at all.
    for (const geolocation of [fakeGeolocation({ code: 3 }).geolocation, fakeGeolocation({ code: 2 }).geolocation, null]) {
      tuned = [];
      newPage();
      answer();
      newTuner(geolocation).start();
      await settle();
      expect(describeTuned()).toEqual(["country:IN/Maharashtra/mh-fm"]);
      expect(storage.getItem("radio-location:1:declined")).toBeNull();
    }
  });

  it("uses the time-zone country when there are no stations near the listener", async () => {
    // Nothing nearby at either distance — including a server that ignores the distance and
    // answers with stations from far away.
    for (const nearbyAnswer of [[], [geoStation("delhi", "IN", "Delhi", 28.61, 77.21, 99999), geoStation("athens", "GR", "Attica", 37.98, 23.73, 99999)]]) {
      tuned = [];
      newBrowser();
      const requests = answer(localDirectory((url) => (url.searchParams.has("geo_lat") ? nearbyAnswer : undefined)));
      newTuner(fakeGeolocation(BENGALURU).geolocation).start();
      await settle();
      expect(requests.slice(0, 4)).toEqual(["countries", "near 13,77.6 within 100 km", "near 13,77.6 within 300 km", "stations IN/*"]);
      expect(describeTuned()).toEqual(["country:IN/Maharashtra/mh-fm"]);
      expect(storage.getItem("radio-location:1:place")).toBeNull();
    }
  });

  it("moves on when the detected city has no playable station", async () => {
    // The first label's stations cannot be played: the next label found nearby is used.
    const unplayable = [station({ stationuuid: "x", countrycode: "IN", state: "Karnataka", ssl_error: 1 }), station({ stationuuid: "y", countrycode: "IN", state: "Karnataka", url: "http://y.example/s", url_resolved: "http://y.example/s" })];
    const tamilNadu = [station({ stationuuid: "tn-1", name: "Hosur 102.2 FM", countrycode: "IN", state: "Tamil Nadu", clickcount: 12 })];
    const requests = answer(localDirectory((url) => (url.searchParams.get("state")?.trim().toLowerCase() === "karnataka" ? unplayable : url.searchParams.get("state") === "Tamil Nadu" ? tamilNadu : undefined)));
    newTuner(fakeGeolocation(BENGALURU).geolocation).start();
    await settle();
    expect(requests).toContain("stations IN/Tamil Nadu");
    expect(describeTuned()).toEqual(["location:IN/Tamil Nadu/tn-1"]);
    expect(JSON.parse(storage.getItem("radio-location:1:place")!).cityLabel).toBe("Tamil Nadu");
  });

  it("uses the detected country, not the time zone, when none of the nearby cities has a playable station", async () => {
    const athens = [geoStation("ath-1", "GR", "Attica", 37.98, 23.73, 10)];
    const greeceTop = [station({ stationuuid: "gr-top", name: "Greek Hit", countrycode: "GR", state: "Crete", clickcount: 900 })];
    answer(localDirectory((url) => {
      if (url.searchParams.has("geo_lat")) return athens;
      if (url.searchParams.get("countrycode") === "GR") return url.searchParams.get("state") === null ? greeceTop : [];
      return undefined;
    }));
    newTuner(fakeGeolocation({ latitude: 37.9838, longitude: 23.7275 }).geolocation).start(); // time zone says India
    await settle();
    // "Crete" is not in Greece's city list here, so the station is given without a city.
    expect(describeTuned()).toEqual(["country:GR/-/gr-top"]);
    expect(tuned[0].stations.map((entry) => entry.stationuuid)).toEqual(["gr-top"]);
    expect(tuned[0].cities).toEqual([]);
    expect(storage.getItem("radio-location:1:place")).toBeNull();
  });

  it("leaves the radio alone when nothing suitable can be found", async () => {
    // No position and a time zone that fits no country.
    answer();
    newTuner(fakeGeolocation({ code: 1 }).geolocation, { timeZone: "Pacific/Auckland" }).start();
    await settle();
    expect(tuned).toEqual([]);

    // A country whose popular stations cannot be played.
    newPage();
    answer(localDirectory((url) => (url.searchParams.get("countrycode") === "IN" && !url.searchParams.has("state") ? [station({ ssl_error: 1, countrycode: "IN", state: "Maharashtra" })] : undefined)));
    newTuner(null).start();
    await settle();
    expect(tuned).toEqual([]);

    // The directory cannot be reached at all: no result and no error escapes.
    newPage();
    answerDirectory(() => new TypeError("Failed to fetch"));
    const tuner = newTuner(fakeGeolocation(BENGALURU).geolocation);
    tuner.start();
    await settle();
    expect(tuned).toEqual([]);
    expect(tuner.claimStart()).toBeNull();
  });

  it("still finds a station when the nearby search itself fails", async () => {
    answer(localDirectory((url) => (url.searchParams.has("geo_lat") ? new Error("Radio directory returned 400") : undefined)));
    newTuner(fakeGeolocation(BENGALURU).geolocation).start();
    await settle();
    expect(describeTuned()).toEqual(["country:IN/Maharashtra/mh-fm"]);
  });

  it("drops the automatic result once the listener has chosen for themselves", async () => {
    // Cancelled while the directory is still being asked: the requests are abandoned.
    const waiting = holdDirectory();
    const tuner = newTuner(fakeGeolocation(BENGALURU).geolocation);
    tuner.start();
    await settle();
    expect(waiting.map((request) => request.kind)).toEqual(["countries"]);
    tuner.cancel();
    expect(waiting[0].signal?.aborted).toBe(true);
    waiting[0].answer([{ name: "India", iso_3166_1: "IN", stationcount: 900 }]);
    await settle();
    expect(waiting).toHaveLength(1);
    expect(tuned).toEqual([]);
    expect(tuner.claimStart()).toBeNull();

    // Cancelled while the browser's prompt is still open: a later "allow" is ignored …
    newPage();
    const requests = answer();
    const prompt = fakeGeolocation("silent");
    const second = newTuner(prompt.geolocation);
    second.start();
    await settle();
    second.cancel();
    prompt.allowLater(BENGALURU);
    vi.advanceTimersByTime(LOCATION_WAIT_MS);
    await settle();
    expect(requests).toEqual(["countries"]);
    expect(tuned).toEqual([]);

    // … but a later "no" is still the listener's answer and is remembered.
    prompt.denyLater();
    expect(storage.getItem("radio-location:1:declined")).toBe(String(Date.now()));
  });

  it("hands the chosen station over once, for the listener's first action to start it", async () => {
    answer();
    const tuner = newTuner(fakeGeolocation(BENGALURU).geolocation);
    expect(tuner.claimStart()).toBeNull(); // nothing chosen yet
    tuner.start();
    await settle();
    expect(tuned).toHaveLength(1);

    // First action: the station. It is handed out once only.
    expect(tuner.claimStart()?.stationuuid).toBe("ka-fm");
    expect(tuner.claimStart()).toBeNull();
    // Nothing is ever reported twice for one start.
    await settle();
    expect(tuned).toHaveLength(1);

    // If the listener chooses something else before starting it, it is not started later.
    newPage();
    answer();
    const other = newTuner(fakeGeolocation(BENGALURU).geolocation);
    other.start();
    await settle();
    expect(tuned).toHaveLength(2);
    other.cancel();
    expect(other.claimStart()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// City / area list: cleaning the directory's free-text location labels

describe("city list normalisation", () => {
  let storage: FakeStorage;
  const rows = (country: string, ...labels: Array<string | [string, number]>) =>
    labels.map((label) => (typeof label === "string" ? { name: label, country, stationcount: 5 } : { name: label[0], country, stationcount: label[1] }));
  const india = (...labels: Array<string | [string, number]>) => citiesFromStates(rows("India", ...labels), "India", "IN");
  const labelsOf = (cities: Array<{ label: string }>) => cities.map((city) => city.label);

  beforeEach(() => {
    storage = new FakeStorage();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows one entry for a name typed in different cases, properly capitalised", () => {
    expect(india("KERALA", "kerala", ["Kerala", 2])).toEqual([{ label: "Kerala", names: ["KERALA", "kerala", "Kerala"] }]);
    // Typed only in lower or only in upper case: shown as a name.
    expect(labelsOf(india("chennai", "GUNTUR", "andhra pradesh", "jammu and kashmir", "NEW DELHI"))).toEqual([
      "Andhra Pradesh",
      "Chennai",
      "Guntur",
      "Jammu and Kashmir",
      "New Delhi",
    ]);
    // Already in mixed case: left as typed. Short all-capital labels are abbreviations.
    expect(labelsOf(citiesFromStates(rows("Germany", "NRW", "Baden-Württemberg", "frankfurt am main", "bad homburg vor der höhe", "McAllen"), "Germany", "DE"))).toEqual([
      "Bad Homburg Vor der Höhe",
      "Baden-Württemberg",
      "Frankfurt am Main",
      "McAllen",
      "NRW",
    ]);
  });

  it("merges obvious misspellings into the more common spelling", () => {
    const cities = india(["Maharashtra", 30], ["Maharastra", 2], ["Chhattisgarh", 2], ["Chhattishgarh", 1], ["kerala", 40], ["KERAKLA", 1], ["Uttar Pradesh", 9], ["Utar Pradsh", 1]);
    expect(cities).toEqual([
      { label: "Chhattisgarh", names: ["Chhattisgarh", "Chhattishgarh"] },
      { label: "Kerala", names: ["kerala", "KERAKLA"] },
      { label: "Maharashtra", names: ["Maharashtra", "Maharastra"] },
      { label: "Uttar Pradesh", names: ["Uttar Pradesh", "Utar Pradsh"] },
    ]);
    // The more common spelling is the one shown, whichever comes first.
    expect(india(["Maharastra", 2], ["Maharashtra", 30])).toEqual([{ label: "Maharashtra", names: ["Maharashtra", "Maharastra"] }]);
  });

  it("does not merge different places that merely look alike", () => {
    const uk = citiesFromStates(rows("The United Kingdom", ["Bolton", 4], ["Boston", 3], ["Reading", 9], ["Redding", 5]), "The United Kingdom", "GB");
    expect(labelsOf(uk)).toEqual(["Bolton", "Boston", "Reading", "Redding"]);
    const us = citiesFromStates(
      rows("The United States Of America", ["North Carolina", 40], ["South Carolina", 30], ["North Dakota", 9], ["South Dakota", 8], ["Stamford", 10], ["Stanford", 9], ["Iowa", 20], ["Ohio", 60], ["District 8", 3], ["District 9", 1], ["Kansas", 30], ["Arkansas", 20], ["Salem", 30], ["Selma", 2]),
      "The United States Of America",
      "US",
    );
    // "Salem" and "Selma" have the same letters, three changes apart.
    expect(labelsOf(us)).toEqual(["Arkansas", "District 8", "District 9", "Iowa", "Kansas", "North Carolina", "North Dakota", "Ohio", "Salem", "Selma", "South Carolina", "South Dakota", "Stamford", "Stanford"]);
    const germany = citiesFromStates(rows("Germany", ["Hessen", 50], ["Essen", 4], ["Singen", 2], ["Siegen", 2], ["Goa", 9], ["Gia", 1]), "Germany", "DE");
    expect(labelsOf(germany)).toEqual(["Essen", "Gia", "Goa", "Hessen", "Siegen", "Singen"]);
  });

  it("tidies spacing and punctuation", () => {
    expect(india("Giridih , Jharkhand")).toEqual([{ label: "Giridih", names: ["Giridih , Jharkhand"] }]);
    expect(india("  New   Delhi ", "Mumbai.", '"Pune"', "(Delhi", " - Goa - ", "Kochi ;", "Washington D.C.")).toEqual([
      { label: "Delhi", names: ["(Delhi"] },
      { label: "Goa", names: [" - Goa - "] },
      { label: "Kochi", names: ["Kochi ;"] },
      { label: "Mumbai", names: ["Mumbai."] },
      { label: "New Delhi", names: ["  New   Delhi "] },
      { label: "Pune", names: ['"Pune"'] },
      { label: "Washington D.C.", names: ["Washington D.C."] },
    ]);
    // A complete pair of brackets is part of a name.
    expect(labelsOf(citiesFromStates(rows("Germany", "Frankfurt (Oder)", "Frankfurt"), "Germany", "DE"))).toEqual(["Frankfurt", "Frankfurt (Oder)"]);
  });

  it("removes labels that are the same once case, spaces, punctuation and accents are ignored", () => {
    expect(india(["Tamil Nadu", 60], ["Tamilnadu", 7], "tamil-nadu", "TAMIL  NADU", "Tamil Nadu.")).toEqual([
      { label: "Tamil Nadu", names: ["Tamil Nadu", "Tamilnadu", "tamil-nadu", "TAMIL  NADU", "Tamil Nadu."] },
    ]);
    expect(india(["Jammu and Kashmir", 40], "Jammu & Kashmir", "jammu  And kashmir")).toEqual([
      { label: "Jammu and Kashmir", names: ["Jammu and Kashmir", "Jammu & Kashmir", "jammu  And kashmir"] },
    ]);
    expect(citiesFromStates(rows("Canada", ["Québec", 30], "Quebec", "QUEBEC", ["St. John's", 40], "Saint John's"), "Canada", "CA")).toEqual([
      { label: "Québec", names: ["Québec", "Quebec", "QUEBEC"] },
      { label: "St. John's", names: ["St. John's", "Saint John's"] },
    ]);
    // With and without the accent is one name even when both are equally common.
    expect(citiesFromStates(rows("Switzerland", "Zürich", "Zurich"), "Switzerland", "CH")).toEqual([{ label: "Zurich", names: ["Zürich", "Zurich"] }]);
  });

  it("drops labels that only name the country, and keeps the areas stations are filed under", () => {
    const cities = india(["India", 4], "INDIA", "IN", "Bharat, India", ["Karnataka", 25], ["Goa", 3], ["Mumbai", 3], "Mumbai, India", "Delhi India", "India - Pune");
    // "Karnataka" and "Goa" are states. The directory files stations under them and has nothing
    // that tells a state from a city, so they stay, cleaned like every other label.
    expect(cities).toEqual([
      { label: "Bharat", names: ["Bharat, India"] },
      { label: "Delhi", names: ["Delhi India"] },
      { label: "Goa", names: ["Goa"] },
      { label: "Karnataka", names: ["Karnataka"] },
      { label: "Mumbai", names: ["Mumbai", "Mumbai, India"] },
      { label: "Pune", names: ["India - Pune"] },
    ]);
    // A country and its main city can share a name: kept when a real share of the stations use it.
    expect(labelsOf(citiesFromStates(rows("Luxembourg", ["Luxembourg", 30], ["Esch-sur-Alzette", 5]), "Luxembourg", "LU"))).toEqual(["Esch-sur-Alzette", "Luxembourg"]);
    // The country's name is not cut off when what remains is not a name.
    expect(labelsOf(citiesFromStates(rows("Ireland", ["Dublin", 30], "Northern Ireland", "Ireland"), "Ireland", "IE"))).toEqual(["Dublin", "Northern Ireland"]);
    expect(labelsOf(citiesFromStates(rows("The Netherlands", ["Utrecht", 50], "Netherlands", "The Netherlands", "utrecht netherlands"), "The Netherlands", "NL"))).toEqual(["Utrecht"]);
  });

  it("drops labels that are not places at all", () => {
    expect(
      labelsOf(
        india(
          "National", "NATIONAL", "Nationwide", "All India", "Pan India", "Online", "internet", "Worldwide", "Unknown", "N/A", "Not / Available", "X", "-", "...", "12345",
          "https://radio.example/in", "www.radio.example", "radio@example.in", "listen.example.com", `${"Somewhere ".repeat(8)}long`, "", "   ",
          "Pune",
        ),
      ),
    ).toEqual(["Pune"]);
  });

  it("files a label made of two places under each of them instead of listing it", () => {
    const cities = india(["Kolkata", 6], ["Mumbai", 3], ["Kolkata Mumbai", 1], ["Chennai", 5], ["Delhi", 20], ["Chennai and Delhi", 1], ["Mumbai/Delhi", 1]);
    expect(cities).toEqual([
      { label: "Chennai", names: ["Chennai", "Chennai and Delhi"] },
      { label: "Delhi", names: ["Delhi", "Chennai and Delhi"] },
      { label: "Kolkata", names: ["Kolkata", "Kolkata Mumbai"] },
      // "Mumbai/Delhi" is read like "City, Region": the first place named.
      { label: "Mumbai", names: ["Mumbai", "Mumbai/Delhi", "Kolkata Mumbai"] },
    ]);
    // A name that only contains other names is left alone: "New Delhi" is not "New" + "Delhi",
    // and a region more common than its parts is a place in its own right.
    expect(labelsOf(india(["Delhi", 20], ["New Delhi", 8], ["Jammu", 2], ["Kashmir", 1], ["Jammu and Kashmir", 9], ["Navi Mumbai", 2], ["Mumbai", 3]))).toEqual([
      "Delhi",
      "Jammu",
      "Jammu and Kashmir",
      "Kashmir",
      "Mumbai",
      "Navi Mumbai",
      "New Delhi",
    ]);
  });

  it("joins a label cut short by the country's name to the one name it begins", () => {
    expect(india(["Tamil Nadu", 60], ["Tamil India", 1])).toEqual([{ label: "Tamil Nadu", names: ["Tamil Nadu", "Tamil India"] }]);
    // Nothing to join, or more than one candidate: it stays what it says.
    expect(labelsOf(india(["Tamil India", 1], "Pune"))).toEqual(["Pune", "Tamil"]);
    expect(labelsOf(india(["Tamil Nadu", 60], ["Tamilakam", 3], ["Tamil India", 1]))).toEqual(["Tamil", "Tamil Nadu", "Tamilakam"]);
  });

  it("keeps the region when two cities share a name, and leaves out a region that distinguishes nothing", () => {
    const us = citiesFromStates(
      rows("The United States Of America", ["Portland, Oregon", 12], ["Portland , Maine", 4], "portland, oregon", ["Portland", 2], ["Austin, Texas", 9], "Austin, TX", ["Seattle, Washington", 7], "Seattle"),
      "The United States Of America",
      "US",
    );
    expect(us).toEqual([
      // "Texas" and "TX" are two spellings here, so both Austin labels keep theirs.
      { label: "Austin, Texas", names: ["Austin, Texas"] },
      { label: "Austin, TX", names: ["Austin, TX"] },
      { label: "Portland", names: ["Portland"] },
      { label: "Portland, Maine", names: ["Portland , Maine"] },
      { label: "Portland, Oregon", names: ["Portland, Oregon", "portland, oregon"] },
      { label: "Seattle", names: ["Seattle, Washington", "Seattle"] },
    ]);
  });

  it("cannot tell a foreign place from a small town, so a stray label stays", () => {
    // "Tampere" is in Finland. Nothing in the directory's list says so, and a one-station
    // label looks exactly like a real small town ("Siwan"). Both are kept.
    expect(labelsOf(india(["Siwan", 1], ["Tampere", 1], ["guntur", 1]))).toEqual(["Guntur", "Siwan", "Tampere"]);
  });

  it("cleans the list from the screenshot of India as a whole", () => {
    const cities = india(
      ["andhra pradesh", 6], ["Bangalore", 4], ["Bihar", 3], ["chennai", 5], ["Chhattisgarh", 2], ["Chhattishgarh", 1], ["Delhi", 20], ["Giridih , Jharkhand", 1],
      ["Goa", 3], ["Gujarat", 9], ["guntur", 1], ["Haryana", 2], ["hyderabad", 4], ["Jammu and Kashmir", 2], ["Karnataka", 25], ["KERAKLA", 1], ["kerala", 40],
      ["Kolkata", 6], ["Kolkata Mumbai", 1], ["Madhya Pradesh", 4], ["Maharashtra", 30], ["Maharastra", 2], ["Mumbai", 3], ["muzaffarnagar", 1], ["National", 5],
      ["New Delhi", 8], ["Punjab", 12], ["Rajasthan", 5], ["Siwan", 1], ["Tamil India", 1], ["Tamil Nadu", 60], ["Tamilnadu", 7], ["Tampere", 1],
    );
    expect(labelsOf(cities)).toEqual([
      "Andhra Pradesh", "Bangalore", "Bihar", "Chennai", "Chhattisgarh", "Delhi", "Giridih", "Goa", "Gujarat", "Guntur", "Haryana", "Hyderabad",
      "Jammu and Kashmir", "Karnataka", "Kerala", "Kolkata", "Madhya Pradesh", "Maharashtra", "Mumbai", "Muzaffarnagar", "New Delhi", "Punjab", "Rajasthan",
      "Siwan", "Tamil Nadu", "Tampere",
    ]);
    // Every label the directory uses is still behind an entry, except the one that is no place.
    const behind = new Set(cities.flatMap((city) => city.names));
    expect(behind.has("National")).toBe(false);
    expect(behind.size).toBe(32);
    // No two entries are the same name.
    expect(new Set(labelsOf(cities).map((label) => label.toLowerCase().replace(/[^a-z]/g, ""))).size).toBe(cities.length);
  });

  it("builds the fallback list from station labels by the same rules", () => {
    const cities = citiesFromStations(
      [
        ...Array.from({ length: 6 }, (_, index) => station({ stationuuid: `m${index}`, state: "Maharashtra" })),
        station({ stationuuid: "typo", state: "Maharastra" }),
        ...Array.from({ length: 4 }, (_, index) => station({ stationuuid: `k${index}`, state: "kerala" })),
        station({ stationuuid: "typo-2", state: "KERAKLA" }), // merged only because "kerala" is counted as far more common
        station({ stationuuid: "lower", state: "pune" }),
        station({ stationuuid: "none", state: "National" }),
        station({ stationuuid: "country", state: "India" }),
        station({ stationuuid: "empty", state: " " }),
        station({ stationuuid: "missing" }),
      ],
      "India",
      "IN",
    );
    expect(cities).toEqual([
      { label: "Kerala", names: ["kerala", "KERAKLA"] },
      { label: "Maharashtra", names: ["Maharashtra", "Maharastra"] },
      { label: "Pune", names: ["pune"] },
    ]);
  });

  it("still finds a city's stations under every label the directory uses for it", async () => {
    const requested: string[] = [];
    answerDirectory((url) => {
      if (url.pathname === "/json/countries") return [{ name: "India", iso_3166_1: "IN", stationcount: 900 }];
      if (url.pathname.startsWith("/json/states/")) {
        return rows("India", ["Maharashtra", 30], ["Maharastra", 2], ["Kolkata", 6], ["Mumbai", 3], ["Kolkata Mumbai", 1], ["Giridih , Jharkhand", 1], ["National", 5]);
      }
      const state = url.searchParams.get("state");
      requested.push(`${url.searchParams.get("countrycode")}|${state}|exact=${url.searchParams.get("stateExact")}`);
      if (state === "Maharashtra") return [station({ stationuuid: "mh-1", name: "Pune One", clickcount: 5 }), station({ stationuuid: "mh-2", name: "Broken", ssl_error: 1, clickcount: 99 })];
      if (state === "Maharastra") return [station({ stationuuid: "mh-3", name: "Typo FM", clickcount: 50 }), station({ stationuuid: "mh-1", name: "Pune One", clickcount: 5 })];
      if (state === "Kolkata Mumbai") return [station({ stationuuid: "both", name: "Two Cities", clickcount: 7 })];
      if (state === "Mumbai") return [station({ stationuuid: "mum", name: "Mumbai One", clickcount: 9 })];
      if (state === "Giridih , Jharkhand") return [station({ stationuuid: "gir", name: "Giridih FM", clickcount: 1 })];
      return [];
    });

    const cities = await radioDirectory.listCountryCities(INDIA);
    expect(labelsOf(cities)).toEqual(["Giridih", "Kolkata", "Maharashtra", "Mumbai"]);

    // Each of the directory's own spellings is asked for exactly; the results are one list,
    // without repeats, still filtered for playability and sorted by popularity.
    const maharashtra = await radioDirectory.listCityStations("IN", cities[2]);
    expect(requested).toEqual(["IN|Maharashtra|exact=true", "IN|Maharastra|exact=true"]);
    expect(maharashtra.map((entry) => entry.stationuuid)).toEqual(["mh-3", "mh-1"]);

    // The displayed name differs from the directory's label: the lookup uses the label.
    requested.length = 0;
    expect((await radioDirectory.listCityStations("IN", cities[0])).map((entry) => entry.stationuuid)).toEqual(["gir"]);
    expect(requested).toEqual(["IN|Giridih , Jharkhand|exact=true"]);

    // A station labelled with two cities is found under both.
    expect((await radioDirectory.listCityStations("IN", cities[3])).map((entry) => entry.stationuuid)).toEqual(["mum", "both"]);
    expect((await radioDirectory.listCityStations("IN", cities[1])).map((entry) => entry.stationuuid)).toEqual(["both"]);

    // The automatic local station finds the entry by any label a station carries.
    expect(findCity(cities, "maharastra")?.label).toBe("Maharashtra");
    expect(findCity(cities, " giridih ,  jharkhand")?.label).toBe("Giridih");
    expect(findCity(cities, "MAHARASHTRA")?.label).toBe("Maharashtra");
    expect(findCity(cities, "National")).toBeUndefined();
  });

  it("does not reuse a city list stored before the labels were cleaned", async () => {
    storage.setItem("radio-directory:1:cities:IN", `${Date.now()}\n${JSON.stringify([{ label: "KERAKLA", names: ["KERAKLA"] }, { label: "National", names: ["National"] }])}`);
    storage.setItem("radio-directory:1:cities:GR", `${Date.now()}\n[]`);
    const requests = answerDirectory((url) => (url.pathname.startsWith("/json/states/") ? rows("India", ["kerala", 40], ["KERAKLA", 1], ["National", 5]) : []));

    expect(await radioDirectory.listCountryCities(INDIA)).toEqual([{ label: "Kerala", names: ["kerala", "KERAKLA"] }]);
    expect(requests).toEqual(["cities India"]);
    // The earlier lists are gone; the new one is stored under its own name and reused.
    expect(storage.keys()).toEqual(["radio-directory:1:cities2:IN"]);
    resetDirectoryMemory();
    expect(await radioDirectory.listCountryCities(INDIA)).toEqual([{ label: "Kerala", names: ["kerala", "KERAKLA"] }]);
    expect(requests).toEqual(["cities India"]);
  });
});
