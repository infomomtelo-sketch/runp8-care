-- Add profile photo URL to staff and residents
-- Apply manually in the Supabase SQL editor.

ALTER TABLE staff     ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS photo_url text;
