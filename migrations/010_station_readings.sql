-- OpenAQ station readings (AEG-OAQ-001): measured PM2.5 from community and low-cost sensors and some agency monitors. NOT Google data.
-- Each station keeps its own open licence (CC BY 4.0, CC0 or public domain); the operator is credited. Kept 30 days.
CREATE TABLE station_readings (
  station_id INTEGER NOT NULL,
  parameter TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  provider TEXT,
  licence TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (station_id, parameter, observed_at)
);
CREATE INDEX station_readings_time ON station_readings(observed_at);
