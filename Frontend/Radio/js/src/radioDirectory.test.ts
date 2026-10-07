import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  STABLE_PLAYBACK_MS,
  STALL_CHECK_MS,
  STALL_CHECKS,
  citiesFromStates,
  citiesFromStations,
  createStationPlayer,
  deduplicateCountries,
  groupStationsByLocation,
  isPlayableStation,
  radioDirectory,
  secureStreamUrl,
  stationFrequencyTenths,
  streamCandidates,
  type PlayerAudio,
  type RadioStation,
} from "./radioDirectory";

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
