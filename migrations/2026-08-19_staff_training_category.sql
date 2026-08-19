-- Which minimum a logged training entry counts toward.
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Additive and safe to
-- re-run: it adds one nullable column and nothing else.
--
-- The 20 annual in-service hours are not interchangeable. Title 22 sets
-- minimums inside them — 8 hours dementia care, 4 hours special care (postural
-- supports, restricted conditions, hospice), 8 hours general — so a caregiver
-- can log 20 hours of general topics, show a full bar, and still not be
-- compliant. Without this column the app can only total the hours.
--
-- Nullable on purpose. Entries logged before this ran keep counting toward the
-- 20 and are shown as "not credited to a minimum" rather than being guessed
-- into a category from their topic text.

alter table public.staff_trainings
  add column if not exists category text;

comment on column public.staff_trainings.category is
  'Which annual in-service minimum these hours count toward: dementia, special_care, general. Null = counts toward the 20 total only.';

-- Optional, and only if you want the database to reject typos as well as the
-- form. Left commented because it fails if any existing row holds a value
-- outside the set; check first with:
--   select distinct category from public.staff_trainings;
--
-- alter table public.staff_trainings
--   add constraint staff_trainings_category_check
--   check (category is null or category in ('dementia','special_care','general'));
