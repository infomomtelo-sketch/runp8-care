-- Title22 facility role/capability helpers
-- Additive and idempotent. Centralizes the current facility-owner/member role
-- lookup in SQL so browser code, Workers, and future RLS/policies can ask the
-- same question without re-implementing it.

create or replace function public.title22_current_facility_role(p_facility_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.facilities f
      where f.id = p_facility_id
        and f.user_id = auth.uid()
    ) then 'administrator'
    else coalesce((
      select fm.role
      from public.facility_members fm
      where fm.facility_id = p_facility_id
        and fm.user_id = auth.uid()
      limit 1
    ), 'readonly')
  end
$$;

grant execute on function public.title22_current_facility_role(uuid) to authenticated;

create or replace function public.title22_has_capability(p_facility_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.title22_current_facility_role(p_facility_id);
begin
  if v_role = 'administrator' then
    return p_capability in (
      'facility.view_directory',
      'resident.read_summary',
      'resident.read_detail',
      'resident.read_sensitive',
      'resident.edit',
      'resident.delete',
      'document.read_metadata',
      'document.read_content',
      'document.share',
      'document.upload',
      'team.manage'
    );
  end if;

  if v_role = 'supervisor' then
    return p_capability in (
      'facility.view_directory',
      'resident.read_summary',
      'resident.read_detail',
      'resident.read_sensitive',
      'resident.edit',
      'resident.delete',
      'document.read_metadata',
      'document.read_content',
      'document.share',
      'document.upload'
    );
  end if;

  if v_role = 'caregiver' then
    return p_capability in (
      'document.read_metadata',
      'document.read_content',
      'document.share',
      'document.upload'
    );
  end if;

  if v_role = 'readonly' then
    return p_capability in (
      'facility.view_directory',
      'resident.read_summary',
      'resident.read_detail',
      'resident.read_sensitive',
      'document.read_metadata',
      'document.read_content',
      'document.share'
    );
  end if;

  return false;
end;
$$;

grant execute on function public.title22_has_capability(uuid, text) to authenticated;
