-- Essential services for the chat's "nearest hospital, clinic, pharmacy, police, fire station, disaster office, shelter" (AEG-NEARBY-001).
-- A copy of OpenStreetMap data for Singapore, Malaysia and Brunei, fetched by tools/fetch-essential-places.ts (ODbL: credit "(c) OpenStreetMap contributors", share-alike applies to a derived database).
-- It is stored because the public Overpass servers are often at capacity and a life-safety answer must not depend on them. Names, coordinates and tagged phone and website only.
CREATE TABLE essential_places (
  osm_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hospital', 'clinic', 'pharmacy', 'police', 'fire_station', 'disaster_centre', 'shelter')),
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  phone TEXT,
  website TEXT,
  address TEXT,
  operator TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (osm_id, category)
);
CREATE INDEX essential_places_geo ON essential_places(category, lat, lng);
