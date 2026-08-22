ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS open_time TEXT
  CHECK (open_time IS NULL OR open_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS close_time TEXT
  CHECK (close_time IS NULL OR close_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

DELETE FROM app_state WHERE key = 'closed_until';
