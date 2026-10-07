import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KNOB_SETTLE_MS,
  createCityListLoader,
  createLocationTuner,
  createStationPlayer,
  radioDirectory,
  stationFrequencyTenths,
  type CityListLoader,
  type LocalTuneResult,
  type LocationTuner,
  type RadioCity,
  type RadioCountry,
  type RadioStation,
  type StationPlayer,
} from "./radioDirectory";

type ScreenMode = "normal" | "volume" | "channel" | "search";
type SearchFocus = "country" | "city" | "station";
type PlaybackState = "idle" | "connecting" | "playing" | "error" | "off";

type KnobGesture = {
  pointerId: number;
  lastAngle: number;
  accumulatedDegrees: number;
  totalDegrees: number;
};

const MIN_FREQUENCY_TENTHS = 875;
const MAX_FREQUENCY_TENTHS = 1080;
const STEP_VOLUME_DEGREES = 5;
const STEP_TUNER_DEGREES = 11;
const STEP_SEARCH_DEGREES = 12;

function formatFrequency(tenths: number) {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

function pointerAngle(event: ReactPointerEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
}

function shortestAngleDelta(current: number, previous: number) {
  return ((current - previous + 540) % 360) - 180;
}

function displayCount(count: number) {
  return `${count} ${count === 1 ? "STATION" : "STATIONS"}`;
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export default function Home() {
  const [poweredOn, setPoweredOn] = useState(true);
  const [mode, setMode] = useState<ScreenMode>("normal");
  const [volume, setVolume] = useState(72);
  const [frequencyTenths, setFrequencyTenths] = useState(925);
  const [hasTuned, setHasTuned] = useState(false);
  const [knobRotation, setKnobRotation] = useState(0);
  const [currentStation, setCurrentStationState] = useState<RadioStation | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [playbackMessage, setPlaybackMessage] = useState("");

  const [countries, setCountries] = useState<RadioCountry[]>([]);
  const [countryCode, setCountryCode] = useState("");
  const [locations, setLocations] = useState<RadioCity[]>([]);
  const [locationStations, setLocationStations] = useState<RadioStation[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [focusedStationIndex, setFocusedStationIndex] = useState(0);
  const [searchFocus, setSearchFocus] = useState<SearchFocus>("country");
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchError, setSearchError] = useState("");

  const playerRef = useRef<StationPlayer | null>(null);
  const poweredRef = useRef(true);
  const volumeRef = useRef(72);
  const frequencyRef = useRef(925);
  const stationRef = useRef<RadioStation | null>(null);
  const countryCodeRef = useRef("");
  const cityQueryRef = useRef("");
  const searchFocusRef = useRef<SearchFocus>("country");
  const locationsRef = useRef<RadioCity[]>([]);
  const locationStationsRef = useRef<RadioStation[]>([]);
  const cityLoaderRef = useRef<CityListLoader | null>(null);
  const countrySettleRef = useRef(0);
  const countriesRequestedRef = useRef(false);
  const cityRequestIdRef = useRef(0);
  const cityAbortRef = useRef<AbortController | null>(null);
  const locationTunerRef = useRef<LocationTuner | null>(null);
  const knobGestureRef = useRef<KnobGesture | null>(null);
  const suppressClickRef = useRef(false);
  const stationButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const updateCurrentStation = useCallback((station: RadioStation | null) => {
    stationRef.current = station;
    setCurrentStationState(station);
  }, []);

  const updateLocations = useCallback((cities: RadioCity[]) => {
    locationsRef.current = cities;
    setLocations(cities);
  }, []);

  const updateLocationStations = useCallback((stations: RadioStation[]) => {
    locationStationsRef.current = stations;
    setLocationStations(stations);
  }, []);

  const focusSearch = useCallback((focus: SearchFocus) => {
    searchFocusRef.current = focus;
    setSearchFocus(focus);
  }, []);

  const updateCityQuery = useCallback((value: string) => {
    cityQueryRef.current = value;
    setCityQuery(value);
  }, []);

  const loadCountries = useCallback(async () => {
    if (countriesRequestedRef.current) return;
    countriesRequestedRef.current = true;
    setCountriesLoading(true);
    setSearchError("");
    try {
      setCountries(await radioDirectory.listCountries());
    } catch {
      countriesRequestedRef.current = false;
      setSearchError("DIRECTORY UNAVAILABLE · TRY AGAIN");
    } finally {
      setCountriesLoading(false);
    }
  }, []);

  // Starts when the page opens, so the list is ready before SEARCH STATION is touched.
  // Opening SEARCH tries again if an earlier attempt failed.
  useEffect(() => {
    if (poweredOn && countries.length === 0) void loadCountries();
  }, [mode, poweredOn, countries.length, loadCountries]);

  // One loader for the chosen country's city list. It answers at once from the cache, waits
  // for the knob to settle before asking the directory, and cancels a request that a newer
  // choice has replaced.
  if (!cityLoaderRef.current) {
    cityLoaderRef.current = createCityListLoader((result) => {
      if (result.status === "loading") {
        setLocationsLoading(true);
        updateLocations([]);
        updateLocationStations([]);
        updateCityQuery("");
        setStationsLoading(false);
        setSearchMessage("LOADING LOCATION DATA…");
        setSearchError("");
      } else if (result.status === "ready") {
        updateLocations(result.cities);
        setLocationsLoading(false);
        setSearchMessage(result.cities.length ? "CHOOSE A CITY / AREA" : "NO LOCATION DATA IN DIRECTORY");
      } else {
        setSearchError("LOCATION DATA UNAVAILABLE");
        setSearchMessage("");
        setLocationsLoading(false);
      }
    });
  }
  const cityLoader = cityLoaderRef.current;

  useEffect(() => {
    const country = countries.find((entry) => entry.iso_3166_1 === countryCode);
    if (mode !== "search" || !poweredOn || !country) return;
    cityLoader.load(country, countrySettleRef.current);
  }, [cityLoader, countries, countryCode, mode, poweredOn]);

  useEffect(() => {
    if (searchFocus !== "station" || mode !== "search") return;
    stationButtonRefs.current[focusedStationIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedStationIndex, locationStations.length, mode, searchFocus]);

  // One player for the life of the radio. It reports what the current stream is doing;
  // anything belonging to an earlier station is dropped inside the player.
  if (!playerRef.current) {
    playerRef.current = createStationPlayer({
      createAudio: (url) => new Audio(url),
      onChange: (status, failure) => {
        if (!poweredRef.current) return;
        if (status === "connecting") {
          setPlaybackState("connecting");
          setPlaybackMessage("CONNECTING…");
        } else if (status === "playing") {
          setPlaybackState("playing");
          setPlaybackMessage("ON AIR");
        } else {
          setPlaybackState("error");
          setPlaybackMessage(
            failure === "no-secure-stream"
              ? "NO SECURE STREAM AVAILABLE"
              : failure === "blocked"
                ? "PLAYBACK BLOCKED BY BROWSER"
                : "STREAM UNAVAILABLE",
          );
        }
      },
    });
  }
  const player = playerRef.current;

  useEffect(() => {
    return () => {
      player.stop();
      cityLoader.cancel();
      cityAbortRef.current?.abort();
    };
  }, [player, cityLoader]);

  // Puts the station found for the listener's own city on the radio, exactly as if it had been
  // chosen in SEARCH STATION, but without starting it: browsers do not let a page start sound
  // by itself, so it starts on the listener's first action (see startAutoStation).
  function applyLocalStation(result: LocalTuneResult) {
    const { station } = result;
    updateCurrentStation(station);
    const stationFrequency = stationFrequencyTenths(station);
    if (stationFrequency !== null) {
      frequencyRef.current = stationFrequency;
      setFrequencyTenths(stationFrequency);
      setHasTuned(true);
    }

    // The same place is selected in SEARCH STATION, and its stations are the ones CHANNEL tunes through.
    countryCodeRef.current = result.country.iso_3166_1;
    setCountryCode(result.country.iso_3166_1);
    if (result.city) {
      updateLocations(result.cities);
      updateCityQuery(result.city.label);
    }
    updateLocationStations(result.stations);
    setFocusedStationIndex(Math.max(0, result.stations.findIndex((entry) => entry.stationuuid === station.stationuuid)));
    setSearchMessage(displayCount(result.stations.length));
  }

  // Starts when the radio is on screen, in the background: the radio never waits for it.
  useEffect(() => {
    const tuner = createLocationTuner({ onTuned: applyLocalStation });
    locationTunerRef.current = tuner;
    tuner.start();
    return () => tuner.cancel();
  }, []);

  // The listener has started choosing for themselves: whatever the automatic search finds
  // from now on is dropped, so it can never replace their choice.
  function discardLocalStation() {
    locationTunerRef.current?.cancel();
  }

  // Starts the automatically chosen station on the listener's first action. True when it did.
  function startAutoStation() {
    const station = locationTunerRef.current?.claimStart();
    if (!station || !poweredRef.current) return false;
    startPlayback(station);
    return true;
  }

  function handleStageClickCapture(event: React.MouseEvent<HTMLElement>) {
    if (!startAutoStation()) return;
    // A first press on the knob starts the station instead of switching the radio off.
    if (event.target instanceof Element && event.target.closest(".volume-knob")) event.stopPropagation();
  }

  function handleStageKeyDownCapture(event: React.KeyboardEvent<HTMLElement>) {
    // Enter and Space arrive as a click; the arrow keys are the knob's keys.
    if (event.key.startsWith("Arrow")) startAutoStation();
  }

  function clearAudioMessage() {
    setPlaybackMessage("");
    setPlaybackState("idle");
  }

  function pauseAudio() {
    player.stop();
    setPlaybackState("idle");
  }

  function startPlayback(station: RadioStation) {
    player.play(station, volumeRef.current / 100);
  }

  function togglePower() {
    discardLocalStation();
    if (poweredRef.current) {
      poweredRef.current = false;
      player.stop();
      setPlaybackState("off");
      setPlaybackMessage("POWER OFF");
      setPoweredOn(false);
      return;
    }

    poweredRef.current = true;
    setPoweredOn(true);
    const station = stationRef.current;
    if (station) {
      startPlayback(station);
    } else if (hasTuned) {
      setPlaybackState("idle");
      setPlaybackMessage(locationStationsRef.current.length ? "NO STATION AT THIS FREQUENCY" : "SEARCH FOR A STATION");
    } else {
      clearAudioMessage();
    }
  }

  function adjustVolume(direction: number) {
    const next = Math.max(0, Math.min(100, volumeRef.current + direction));
    volumeRef.current = next;
    setVolume(next);
    player.setVolume(next / 100);
  }

  function tune(direction: number) {
    discardLocalStation();
    const next = Math.max(MIN_FREQUENCY_TENTHS, Math.min(MAX_FREQUENCY_TENTHS, frequencyRef.current + direction));
    frequencyRef.current = next;
    setFrequencyTenths(next);
    setHasTuned(true);

    const match = locationStationsRef.current.find((station) => stationFrequencyTenths(station) === next);
    updateCurrentStation(match ?? null);
    if (match && poweredRef.current) {
      startPlayback(match);
    } else {
      pauseAudio();
      setPlaybackMessage(
        locationStationsRef.current.length
          ? `NO STATION AT ${formatFrequency(next)} MHz`
          : "SEARCH FOR A LOCATION FIRST",
      );
    }
  }

  // `settleMs` is how long to wait for further changes before asking the directory
  // (used when the knob steps through countries).
  function selectCountry(code: string, settleMs = 0) {
    countryCodeRef.current = code;
    setCountryCode(code);
    countrySettleRef.current = settleMs;
    cityLoader.cancel();
    cityRequestIdRef.current += 1;
    cityAbortRef.current?.abort();
    setStationsLoading(false);
    updateCityQuery("");
    updateLocations([]);
    updateLocationStations([]);
    setFocusedStationIndex(0);
    setSearchError("");
    setSearchMessage(code ? "LOADING LOCATION DATA…" : "CHOOSE A COUNTRY");
    focusSearch("country");
    const country = countries.find((entry) => entry.iso_3166_1 === code);
    if (country) cityLoader.load(country, settleMs);
  }

  async function searchCity(location: string) {
    const name = normalizeText(location);
    const city = locationsRef.current.find((entry) => normalizeText(entry.label) === name);
    if (!countryCodeRef.current || !city) {
      setSearchMessage("CHOOSE A COUNTRY AND CITY");
      return;
    }

    const requestId = ++cityRequestIdRef.current;
    const superseded = cityAbortRef.current;
    const request = new AbortController();
    cityAbortRef.current = request;
    setStationsLoading(true);
    setSearchError("");
    setSearchMessage("SEARCHING VERIFIED STREAMS…");
    focusSearch("station");
    try {
      const pending = radioDirectory.listCityStations(countryCodeRef.current, city, request.signal);
      // Leave the earlier search only now, so asking for the same city again joins the
      // request already on its way instead of restarting it.
      superseded?.abort();
      const stations = await pending;
      if (requestId !== cityRequestIdRef.current) return;
      updateLocationStations(stations);
      setFocusedStationIndex(0);
      setSearchMessage(stations.length ? displayCount(stations.length) : "NO VERIFIED STREAMS FOR THIS LOCATION");
    } catch {
      if (requestId !== cityRequestIdRef.current) return;
      updateLocationStations([]);
      setSearchError("STATION DIRECTORY UNAVAILABLE");
      setSearchMessage("");
    } finally {
      if (requestId === cityRequestIdRef.current) setStationsLoading(false);
    }
  }

  function chooseStation(station: RadioStation) {
    discardLocalStation();
    updateCurrentStation(station);
    const stationFrequency = stationFrequencyTenths(station);
    if (stationFrequency !== null) {
      frequencyRef.current = stationFrequency;
      setFrequencyTenths(stationFrequency);
      setHasTuned(true);
    }
    setMode("normal");
    if (poweredRef.current) startPlayback(station);
  }

  function chooseScreenMode(nextMode: ScreenMode) {
    if (!poweredRef.current) return;
    // Searching or tuning is the listener's own choice (adjusting the volume is not).
    if (nextMode !== "volume") discardLocalStation();
    if (mode === "search" && nextMode === "search") {
      setMode("normal");
      return;
    }
    setMode(nextMode);
    if (nextMode === "search") focusSearch("country");
  }

  function navigateSearch(direction: number) {
    const focus = searchFocusRef.current;
    if (focus === "country" && countries.length > 0) {
      const currentIndex = countries.findIndex((country) => country.iso_3166_1 === countryCodeRef.current);
      const start = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
      const nextIndex = (start + direction + countries.length) % countries.length;
      selectCountry(countries[nextIndex].iso_3166_1, KNOB_SETTLE_MS);
      return;
    }

    if (focus === "city" && locations.length > 0) {
      const currentIndex = locations.findIndex((location) => normalizeText(location.label) === normalizeText(cityQueryRef.current));
      const start = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
      const next = locations[(start + direction + locations.length) % locations.length];
      updateCityQuery(next.label);
      void searchCity(next.label);
      return;
    }

    if (focus === "station" && locationStations.length > 0) {
      const nextIndex = Math.max(0, Math.min(locationStations.length - 1, focusedStationIndex + direction));
      setFocusedStationIndex(nextIndex);
      stationButtonRefs.current[nextIndex]?.focus();
    }
  }

  function turnKnob(direction: number) {
    if (!poweredRef.current) return;
    if (mode === "volume") adjustVolume(direction);
    else if (mode === "channel") tune(direction);
    else if (mode === "search") navigateSearch(direction);
  }

  function handleKnobPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    knobGestureRef.current = {
      pointerId: event.pointerId,
      lastAngle: pointerAngle(event),
      accumulatedDegrees: 0,
      totalDegrees: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleKnobPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = knobGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !poweredRef.current) return;
    const nextAngle = pointerAngle(event);
    const delta = shortestAngleDelta(nextAngle, gesture.lastAngle);
    gesture.lastAngle = nextAngle;
    gesture.accumulatedDegrees += delta;
    gesture.totalDegrees += Math.abs(delta);
    if (Math.abs(delta) > 0.15) {
      setKnobRotation((current) => (current + delta + 360) % 360);
    }

    const threshold = mode === "volume" ? STEP_VOLUME_DEGREES : mode === "channel" ? STEP_TUNER_DEGREES : STEP_SEARCH_DEGREES;
    while (gesture.accumulatedDegrees >= threshold) {
      turnKnob(1);
      gesture.accumulatedDegrees -= threshold;
    }
    while (gesture.accumulatedDegrees <= -threshold) {
      turnKnob(-1);
      gesture.accumulatedDegrees += threshold;
    }
  }

  function handleKnobPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = knobGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    knobGestureRef.current = null;
    suppressClickRef.current = gesture.totalDegrees > 7;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function handleKnobClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    togglePower();
  }

  function handleKnobKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      turnKnob(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      turnKnob(-1);
    }
  }

  function handleCitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchCity(cityQueryRef.current);
  }

  function handleCityChange(value: string) {
    updateCityQuery(value);
    if (value) {
      void searchCity(value);
      return;
    }
    cityRequestIdRef.current += 1;
    cityAbortRef.current?.abort();
    setStationsLoading(false);
    updateLocationStations([]);
    setSearchMessage("CHOOSE A CITY / AREA");
  }

  const activeFrequency = currentStation ? stationFrequencyTenths(currentStation) : null;
  const mainFrequency = currentStation
    ? activeFrequency === null
      ? "\u00A0" // no FM frequency for this station: leave the line blank (keeps its height)
      : formatFrequency(activeFrequency)
    : formatFrequency(frequencyTenths);
  const mainStationName = currentStation?.name ?? (hasTuned ? "NO STATION" : "BIG FM");
  const channelStationName = currentStation?.name ?? (locationStations.length ? "NO STATION" : "SEARCH FOR A LOCATION");

  return (
    <main
      className={`radio-stage${poweredOn ? "" : " radio-is-off"}`}
      aria-label="Radio 92.5"
      onClickCapture={handleStageClickCapture}
      onKeyDownCapture={handleStageKeyDownCapture}
    >
      <div className="radio-canvas">
        <section className="radio-housing" aria-label="Metal radio body">
          <div className="radio-face">
            <section className="control-panel" aria-label="Left control panel">
              <span className="status-lamp" aria-hidden="true" />
              <button
                type="button"
                className="volume-knob"
                style={{ "--knob-turn": `${knobRotation}deg` } as CSSProperties}
                aria-label={poweredOn ? "Power off. Rotate to adjust the selected mode." : "Power on"}
                aria-pressed={poweredOn}
                onPointerDown={handleKnobPointerDown}
                onPointerMove={handleKnobPointerMove}
                onPointerUp={handleKnobPointerUp}
                onPointerCancel={handleKnobPointerUp}
                onClick={handleKnobClick}
                onKeyDown={handleKnobKeyDown}
              >
                <span className="knob-ridge" aria-hidden="true">
                  <span className="knob-face" />
                </span>
              </button>
            </section>

            <section
              className={`display-panel${poweredOn ? "" : " display-inactive"}`}
              aria-label="Touchscreen display"
              data-playback={playbackState}
              aria-live="polite"
            >
              {mode === "normal" && (
                <div className="screen-readout" key="normal">
                  <span className="frequency">{mainFrequency}</span>
                  <span className="station-name">{mainStationName}</span>
                  {playbackMessage && <span className="screen-status">{playbackMessage}</span>}
                </div>
              )}

              {mode === "volume" && (
                <div className="screen-readout mode-readout" key="volume">
                  <span className="mode-title">VOLUME</span>
                  <span className="volume-value">{volume}</span>
                  <span className="screen-hint">TURN KNOB · 0–100</span>
                  {playbackMessage && <span className="screen-status">{playbackMessage}</span>}
                </div>
              )}

              {mode === "channel" && (
                <div className="screen-readout mode-readout" key="channel">
                  <span className="mode-title">CHANNEL</span>
                  <span className="frequency">{formatFrequency(frequencyTenths)}</span>
                  <span className="station-name">{channelStationName}</span>
                  <span className="screen-hint">TURN KNOB · 87.5–108.0 MHz</span>
                  {playbackMessage && <span className="screen-status">{playbackMessage}</span>}
                </div>
              )}

              {mode === "search" && (
                <div className="search-workspace" key="search">
                  <div className="search-heading">SEARCH STATION</div>
                  <form className="search-fields" onSubmit={handleCitySubmit}>
                    <label className={`screen-field${searchFocus === "country" ? " is-focused" : ""}`}>
                      <span>COUNTRY</span>
                      <select
                        value={countryCode}
                        disabled={!poweredOn || countriesLoading}
                        onFocus={() => focusSearch("country")}
                        onChange={(event) => selectCountry(event.target.value)}
                      >
                        <option value="">{countriesLoading ? "LOADING…" : "SELECT COUNTRY"}</option>
                        {countries.map((country) => (
                          <option value={country.iso_3166_1} key={country.iso_3166_1}>
                            {country.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className={`city-search-control${searchFocus === "city" ? " is-focused" : ""}`}>
                      <label className="screen-field" htmlFor="radio-city-query">
                        <span>CITY</span>
                        <select
                          id="radio-city-query"
                          value={cityQuery}
                          disabled={!poweredOn || !countryCode || locationsLoading}
                          onFocus={() => focusSearch("city")}
                          onChange={(event) => handleCityChange(event.target.value)}
                        >
                          <option value="">{locationsLoading ? "LOADING…" : "SELECT CITY"}</option>
                          {locations.map((location) => (
                            <option value={location.label} key={normalizeText(location.label)}>
                              {location.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="find-location-button" type="submit" disabled={!poweredOn || !countryCode || !cityQuery.trim()}>
                        FIND
                      </button>
                    </div>
                  </form>
                  <div className="directory-note">CITY / AREA LABELS COME FROM STATION DATA</div>
                  {searchError && <div className="search-feedback is-error">{searchError}</div>}
                  {searchMessage && !searchError && <div className="search-feedback">{searchMessage}</div>}
                  <div className="station-list" role="listbox" aria-label="Available radio stations">
                    {stationsLoading && <div className="station-empty">SEARCHING…</div>}
                    {!stationsLoading && locationStations.map((station, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={focusedStationIndex === index}
                        className={`station-result${focusedStationIndex === index ? " is-cursor" : ""}`}
                        key={station.stationuuid}
                        ref={(element) => { stationButtonRefs.current[index] = element; }}
                        onFocus={() => {
                          setFocusedStationIndex(index);
                          focusSearch("station");
                        }}
                        onClick={() => chooseStation(station)}
                      >
                        <span className="station-result-name">{station.name}</span>
                        <span className="station-result-meta">
                          {[station.codec, station.bitrate ? `${station.bitrate}K` : ""].filter(Boolean).join(" · ") || "STREAM"}
                        </span>
                      </button>
                    ))}
                    {!stationsLoading && !locationStations.length && !searchError && searchMessage && (
                      <div className="station-empty">{searchMessage}</div>
                    )}
                  </div>
                </div>
              )}

              <div className="screen-options" role="group" aria-label="Radio modes">
                {(["volume", "channel", "search"] as const).map((option) => (
                  <button
                    className={`screen-option${mode === option ? " is-active" : ""}`}
                    type="button"
                    key={option}
                    aria-pressed={mode === option}
                    disabled={!poweredOn}
                    onClick={() => chooseScreenMode(option)}
                  >
                    {option === "search" ? "SEARCH STATION" : option.toUpperCase()}
                  </button>
                ))}
              </div>
            </section>

            <section className="speaker-panel" aria-label="Right speaker panel">
              <span className="speaker-grille" aria-hidden="true" />
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
