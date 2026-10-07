# Radio — backend resources

Dedicated home for the FM Radio's backend, data and configuration resources.

## Current state: no backend code

The radio is fully client-side. The page in `Frontend/Radio/` asks the public
Radio Browser directory for its data directly from the browser and plays the
stations' own HTTPS streams. Nothing in this folder runs, and nothing needs to
be started for the radio to work.

This folder exists so that radio-specific backend work has one place to go
when it is needed. Nothing has been added just to fill it.

## Where the radio lives

| Location | What it is |
|---|---|
| `Frontend/Radio/` | The live radio: `radio.html`, `css/radio.css`, the built `js/radio.js`, and its source in `js/src/` |
| `Backend/radio/` | This folder: reserved for radio backend resources |
| `Backend/resources/radio92/` | The tested archive of the original FM implementation (full Manus export). Kept as a reference; not used by the page |

## Data source

Radio Browser, `https://de1.api.radio-browser.info` (public, no key).
The requests are made in `Frontend/Radio/js/src/radioDirectory.ts`:

| Purpose | Request |
|---|---|
| Country list | `GET /json/countries?order=name&hidebroken=true&limit=500` |
| City / area list for a country | `GET /json/states/<country name>/?order=name&hidebroken=true` |
| Stations for a city / area | `GET /json/stations/search?countrycode=<ISO code>&state=<label>&stateExact=true&hidebroken=true&is_https=true&limit=500&order=clickcount&reverse=true` |
| Fallback when the city list is empty or unavailable | `GET /json/stations/search?countrycode=<ISO code>&limit=1000&hidebroken=true&is_https=true&order=clickcount&reverse=true` |

Radio Browser has no city field and no city endpoint. The "city" list is its
free-text `state` label, so for some countries it holds states or regions
rather than cities.

## Configuration

The directory server can be changed at build time with the environment
variable `VITE_RADIO_BROWSER_BASES` (comma-separated `https://` addresses,
tried in order), set when `js/radio.js` is rebuilt in `Frontend/Radio/`.
When it is not set, the address above is used.
