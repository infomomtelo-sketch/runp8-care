-- The four practice-site courses staff are enrolled in get catalog rows. 2026-10-08.
--
-- Since 2026-10-07, "Start my training" enrols every staff learner in the four
-- courses in workers/title22-learnupon/wrangler.toml (LEARNUPON_STAFF_COURSE_IDS).
-- The Worker logs hours ONLY from title22_course_catalog, matched on
-- external_ref = the portal's course id, and the only row so far was the old
-- "Eval" test course. So a completion of any of the four logged
-- training_status = no_course_hours and no hours reached the staff record.
--
-- Hours below are the training partner's own numbers, emailed 2026-10-08
-- (Diabetes 2 h, Activities of Daily Living 3 h, Dementia Care: This is Your
-- Brain on Music 1 h, Sexual Harassment - Non-Supervisory 1 h). Nothing is
-- invented. Topic split: ADL -> personal_care, Dementia -> dementia (the
-- course titles say so); the other two carry no topic and land in "other".
-- INACTIVE, like the Eval row: practice-site courses, never offered in the
-- app. The real portal's course ids will differ; add those rows then.
--
-- Additive and safe to run twice.
insert into public.title22_course_catalog
  (provider, title, credit_hours, topic_hours, delivery, counts_toward, external_ref, active)
select v.provider, v.title, v.credit_hours, v.topic_hours::jsonb, 'self_paced', 'direct_care', v.external_ref, false
  from (values
    ('Training partner (sandbox test)', 'Diabetes',                                        2, '{}',                   '3768123'),
    ('Training partner (sandbox test)', 'Activities of Daily Living for Staff',            3, '{"personal_care": 3}', '3768117'),
    ('Training partner (sandbox test)', 'Dementia Care: This is Your Brain on Music for Staff', 1, '{"dementia": 1}', '3768111'),
    ('Training partner (sandbox test)', 'Sexual Harassment - Non-Supervisory',             1, '{}',                   '3768109')
  ) as v(provider, title, credit_hours, topic_hours, external_ref)
 where not exists (select 1 from public.title22_course_catalog c where c.external_ref = v.external_ref);

-- Check: expect five rows (Eval + these four), all inactive.
select title, credit_hours, topic_hours, external_ref, active
  from public.title22_course_catalog where provider = 'Training partner (sandbox test)' order by external_ref;
