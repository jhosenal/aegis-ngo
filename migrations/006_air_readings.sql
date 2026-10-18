-- Official air readings (AEG-PSI-001): the Singapore NEA PSI, one row per published reading (observed_at), kept as a time series so a bulletin can be
-- rebuilt as at its capture time. NOT Google data: source licence is the Singapore Open Data Licence v1.0, so keeping and narrating it is allowed with the notice.
CREATE TABLE air_readings (
  source_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  updated_at TEXT,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (source_id, observed_at)
);
CREATE INDEX air_readings_latest ON air_readings(source_id, observed_at);
