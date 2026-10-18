# AEG-ENG-011 — Google Environment adapter (Air Quality + Weather)

Date: 2026-10-16. Owner: SNET backend. Status: IMPLEMENTED, FIXTURE-TESTED, LIVE-CANARY-TESTED 2026-10-16 (one pin, four kinds, plus one Singapore alerts probe).
Code: `src/sources/googleEnv.ts`, `src/sources/pinRegistry.ts`, `src/costs/envQuota.ts`. Data: `fixtures/environment-pins.json`.
Sources read 2026-10-16 (see E0001 and R0161/R0162 for saved pricing pages).

## Requests (exactly what the adapter sends)

| Kind | Method and URL | Billed as | Notes |
|---|---|---|---|
| AIR_CURRENT | `POST https://airquality.googleapis.com/v1/currentConditions:lookup` | 1 Air Quality event | body: `location{latitude,longitude}`, `extraComputations` = LOCAL_AQI, HEALTH_RECOMMENDATIONS, DOMINANT_POLLUTANT_CONCENTRATION, POLLUTANT_CONCENTRATION, `languageCode` en |
| WEATHER_CURRENT | `GET https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=..&location.longitude=..&unitsSystem=METRIC` | 1 Weather event | |
| WEATHER_HOURLY | `GET https://weather.googleapis.com/v1/forecast/hours:lookup?...&hours=24&pageSize=24` | 1 Weather event | the default is 240 hours = 10 pages = 10 events; never request it; `nextPageToken` is reported as `truncated`, never followed |
| WEATHER_ALERTS | `GET https://weather.googleapis.com/v1/publicAlerts:lookup?location.latitude=..&location.longitude=..&languageCode=en` | 1 Weather event | LIVE: Singapore 200 `{weatherAlerts:[],regionCode:"SG",nextPageToken:""}`; Malaysia 404 NOT_FOUND "Information is not supported for this location" (not billed, returned as `unsupported:true`). Only SG pins are polled for alerts; an empty list is not "no hazard" |

Key: `x-goog-api-key` header only (Google Cloud REST guidance). Never in a URL, a log, or an error. The alerts guide shows `?key=`; we do not use it.
Keys: one per service, `AEGIS_GOOGLE_AIR_API_KEY` for Air Quality and `AEGIS_GOOGLE_WEATHER_API_KEY` for Weather (server-side, read by `googleEnvKeysFromEnv`). The browser Maps key and the Agent Platform key are NOT used.

## Live canary result (2026-10-16, pin my-41 Miri; both keys accepted in the x-goog-api-key header)
- AIR_CURRENT 200: `dateTime, regionCode, indexes[2] {code, displayName, aqi, aqiDisplay, color, category, dominantPollutant}, pollutants[6] {code, displayName, fullName, concentration}, healthRecommendations {generalPopulation, elderly, lungDiseasePopulation, heartDiseasePopulation, athletes, pregnantWomen, children}`.
- WEATHER_CURRENT 200: `temperature{unit,degrees}`, `precipitation{probability{type,percent}, qpf{unit,quantity}}`, `wind{direction{cardinal,degrees}, speed{unit,value}, gust}`, `visibility{unit,distance}`, `relativeHumidity`, `uvIndex`, `thunderstormProbability`, `cloudCover`, `currentConditionsHistory{...}`, `weatherCondition{description{text,languageCode}, type, iconBaseUri}`.
- WEATHER_HOURLY 200: 24 `forecastHours[]` with `interval, displayDateTime, weatherCondition, temperature, feelsLikeTemperature, dewPoint, heatIndex, windChill, wetBulbTemperature, precipitation, airPressure, wind, visibility, iceThickness, isDaytime, relativeHumidity, uvIndex, thunderstormProbability, cloudCover`.
- Raw samples are in `data/runtime/` (git-ignored) until the retention decision is made.
- Usage: 1 Air Quality and 2 Weather events (the Malaysian alerts 404 is not billed), plus 1 Weather event for the Singapore probe.

## Quota and billing contract
- Every call: `gate.reserve` (1 unit) BEFORE the request. Gate refuses on month cap, day cap, paid budget, 100,000-event band, missing price.
- HTTP 2xx: `settle(1)` (even when the body is unusable, a successful request is billed).
- Definite HTTP error (4xx/5xx): `release` (Google bills successful requests only).
- Timeout or network failure: `markLiability` (it may have reached Google); stays counted until reconciled.
- 401/403 stops the whole run after one failure. A gate refusal stops only that service for the run.
- Owner plan: 160 USD ceiling, 80 USD per service, 4 runs a day (07:00, 12:00, 17:00, 22:00 local), 31-day month. 125 pins: 105 Air Quality, Weather = 2 calls on 125 pins plus alerts on the 23 Singapore pins only: 13,020 Air Quality and 33,852 Weather events a month.
- Hazard pins are polled first so a tight daily cap drops routine pins.

## Output
`EnvReading { pinId, kind, sku, fetchedAt, validUntil, attribution, data }`. `data` holds verified top-level fields only; nested shapes are passed through, not reinterpreted. `validUntil` = fetch time + at most 60 minutes. That is Google's caching limit (Service Specific Terms, last modified 2026-10-15): Air Quality current and hourly forecast values 1 hour; Weather current, hourly forecast and public alert values 1 hour. The earlier 10-hour validity was wrong and is removed.
Required attribution is carried with every reading: "Source: Includes air quality data from Google" / "Source: Includes weather data from Google". Alerts also need `dataSource.name` and `authorityUri` shown.

## Not done (open)
1. Live canary: DONE for one pin. A full 125-pin run has not been made.
2. Cache and retention: RESOLVED to the terms above for the live kinds (delete after 1 hour). Storable evidence must come from history endpoints (Air Quality history: until the agreement ends; Weather hourly history: 240 hours), which the adapter does not call yet. Open: Air Quality permitted use (2.1) and no text-to-speech / no content creation (general terms 3.2.3) need an owner decision; see E0002.
3. Config wiring (the two key names exist in `.env`; `config.ts` does not read them yet), scheduler for the four runs, and a read route for the frontend.
4. `x-goog-api-key` is CONFIRMED accepted by Air Quality and Weather (canary 2026-10-16).
5. Weather nested shapes are now observed (see canary result), for unitsSystem METRIC; re-check if units change.
6. Heatmap tiles are not used; if the frontend adds them they bill to the Air Quality event pool and bypass this gate.
