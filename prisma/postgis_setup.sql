CREATE EXTENSION IF NOT EXISTS postgis;

-- Index untuk lokasi kurir
CREATE INDEX IF NOT EXISTS courier_location_idx ON "couriers" USING GIST (
  CAST(ST_SetSRID(ST_MakePoint(CAST(current_lng AS float8), CAST(current_lat AS float8)), 4326) AS geography)
);

-- Index untuk lokasi alamat
CREATE INDEX IF NOT EXISTS address_location_idx ON "addresses" USING GIST (
  CAST(ST_SetSRID(ST_MakePoint(CAST(longitude AS float8), CAST(latitude AS float8)), 4326) AS geography)
);
