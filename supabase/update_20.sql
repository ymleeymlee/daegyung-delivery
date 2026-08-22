ALTER TABLE rider_devices
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS branch text,
  ADD COLUMN IF NOT EXISTS connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_connected_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_rider_devices_branch ON rider_devices(branch);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_riders_phone ON riders(phone) WHERE phone IS NOT NULL;

UPDATE rider_devices
  SET connected = true, last_connected_at = last_seen_at
  WHERE rider_id IS NOT NULL AND last_seen_at IS NOT NULL AND last_seen_at > now() - interval '1 hour';
