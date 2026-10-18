-- Open-Meteo modelled hourly values for the monitored pins (AEG-OMET-001). NOT Google data: CC BY 4.0, credit Open-Meteo. Model output on a grid, not a station reading.
-- One row per pin and hour; temperature and rain come from the forecast API, PM2.5 and PM10 from the CAMS air-quality model. Kept 30 days.
CREATE TABLE pin_observations (
  pin_id TEXT NOT NULL,
  hour_at TEXT NOT NULL,            -- UTC, ISO with Z
  temp_c REAL,
  rain_mm REAL,
  pm25 REAL,
  pm10 REAL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (pin_id, hour_at)
);
CREATE INDEX pin_observations_hour ON pin_observations(hour_at);
