-- Remove the ARF "PPE training for all staff" item (2026-09-30).
--
-- 22 CCR §85095.5(b)(2)(C) sits under subsection (b), which applies only when
-- a client has a contagious disease. Listing it for all staff overstated the
-- law. Items on Infection Control Plan training (§85095.5(c)(1)(C)) and the
-- plan itself (§85095.5(c)) remain.
--
-- Safe to run twice. Removes the item and any task a home was given from it.

delete from public.compliance_tasks
 where checklist_item_id in (
   select id from public.checklist_items
    where facility_types = array['arf'] and regulation_reference = '22 CCR §85095.5(b)(2)(C)');

delete from public.checklist_items
 where facility_types = array['arf'] and regulation_reference = '22 CCR §85095.5(b)(2)(C)';

select coalesce(array_to_string(facility_types, ','), '(none)') as types, count(*)
  from public.checklist_items group by 1 order by 1;
