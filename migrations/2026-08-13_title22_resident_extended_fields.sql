-- Resident extended fields
-- Adds demographic, contact, directive, and financial columns to the residents
-- table. All are optional (nullable) so existing rows are unaffected.

ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS gender                 text,
  ADD COLUMN IF NOT EXISTS spoken_languages       text,
  ADD COLUMN IF NOT EXISTS weight                 text,
  ADD COLUMN IF NOT EXISTS height                 text,
  ADD COLUMN IF NOT EXISTS dnr                    text DEFAULT 'no',
  ADD COLUMN IF NOT EXISTS polst                  text DEFAULT 'no',
  ADD COLUMN IF NOT EXISTS hospice                boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS conserved              boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS conservator_name       text,
  ADD COLUMN IF NOT EXISTS responsible_party_name text,
  ADD COLUMN IF NOT EXISTS responsible_party_phone text,
  ADD COLUMN IF NOT EXISTS responsible_party_relation text,
  ADD COLUMN IF NOT EXISTS physician_name         text,
  ADD COLUMN IF NOT EXISTS physician_phone        text,
  ADD COLUMN IF NOT EXISTS insurance_carrier      text,
  ADD COLUMN IF NOT EXISTS insurance_id           text,
  ADD COLUMN IF NOT EXISTS medi_cal               boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ssi                    boolean DEFAULT false;
