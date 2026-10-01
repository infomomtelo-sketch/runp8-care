-- Partner Tello links, created from a page instead of SQL (2026-10-02).
--
-- Supabase SQL editor, project nwlhsshvqmbhemhxcran. Run AFTER
-- 2026-10-01_partner_tello.sql. Additive and safe to re-run: one table check
-- is replaced with a wider one, and three functions are added. No row is
-- changed; every existing link (64-character keys) keeps working.
--
-- 1. Short links. A key may now be short and readable, like charise-k7q2xm:
--    the person's name, a hyphen and 6 random letters or digits (close to 900
--    million combinations per name, so a link cannot be guessed from the name).
--    title22.app/meet/charise-k7q2xm and title22.app/meet?k=charise-k7q2xm
--    both open it.
--
-- 2. Three functions for title22.app/meet/admin. Each checks that the
--    signed-in account has profiles.title22_is_partner_admin (the same flag
--    the Tello Cabinet's "Partners and payouts" drawer checks), so the page
--    itself grants nothing. Signed out, or not a partner admin: refused.
--      partner_tello_admin_links()                      list, with message counts
--      partner_tello_admin_create(name, org, email, brief)  -> the new key
--      partner_tello_admin_set_active(key, active)      turn a link on or off
--    None of them returns message text: what partners wrote is in the emails.

alter table public.partner_tello_links drop constraint if exists partner_tello_links_key_check;
alter table public.partner_tello_links
  add constraint partner_tello_links_key_check check (key ~ '^[A-Za-z0-9_-]{8,128}$');

create or replace function public.partner_tello_admin_check()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.title22_is_partner_admin
  ) then
    raise exception 'not a partner admin' using errcode = '42501';
  end if;
end $$;

create or replace function public.partner_tello_admin_links()
returns table(key text, name text, org text, email text, brief text, active boolean,
              created_at timestamptz, messages bigint, last_message_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.partner_tello_admin_check();
  return query
    select l.key, l.name, l.org, l.email, l.brief, l.active, l.created_at,
           count(m.id) filter (where m.role in ('user', 'direct')),
           max(m.created_at)
      from public.partner_tello_links l
      left join public.partner_tello_messages m on m.link_key = l.key
     group by l.key
     order by l.created_at desc;
end $$;

create or replace function public.partner_tello_admin_create(
  p_name text, p_org text default null, p_email text default null, p_brief text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_name  text := nullif(btrim(p_name), '');
  v_slug  text;
  v_key   text;
  v_chars text := 'abcdefghjkmnpqrstuvwxyz23456789';   -- no 0/o, 1/l/i: easy to read aloud
  i int;
begin
  perform public.partner_tello_admin_check();
  if v_name is null or length(v_name) > 120 then
    raise exception 'A name is needed (up to 120 characters).' using errcode = '22023';
  end if;
  -- The readable part: the name in lowercase letters and digits, hyphens
  -- between words, at most 20 characters. "link" when nothing is left.
  v_slug := translate(lower(v_name), 'áàäâãåéèëêíìïîóòöôõúùüûñç', 'aaaaaaeeeeiiiiooooouuuunc');
  v_slug := btrim(regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g'), '-');
  v_slug := btrim(left(v_slug, 20), '-');
  if v_slug = '' then v_slug := 'link'; end if;
  loop
    v_key := v_slug || '-';
    for i in 1..6 loop
      v_key := v_key || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.partner_tello_links l where l.key = v_key);
  end loop;
  insert into public.partner_tello_links (key, name, org, email, brief)
  values (v_key, v_name, nullif(btrim(p_org), ''), nullif(btrim(p_email), ''), nullif(btrim(p_brief), ''));
  return v_key;
end $$;

create or replace function public.partner_tello_admin_set_active(p_key text, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.partner_tello_admin_check();
  update public.partner_tello_links set active = p_active where key = p_key;
  if not found then
    raise exception 'No such link.' using errcode = '22023';
  end if;
end $$;

revoke all on function public.partner_tello_admin_check() from public;
revoke all on function public.partner_tello_admin_links() from public;
revoke all on function public.partner_tello_admin_create(text, text, text, text) from public;
revoke all on function public.partner_tello_admin_set_active(text, boolean) from public;
grant execute on function public.partner_tello_admin_links() to authenticated;
grant execute on function public.partner_tello_admin_create(text, text, text, text) to authenticated;
grant execute on function public.partner_tello_admin_set_active(text, boolean) to authenticated;

-- Check (read-only), after running the above. Expect: 3, true.
-- select (select count(*) from pg_proc where proname like 'partner_tello_admin_%' and proname <> 'partner_tello_admin_check') as admin_functions,
--        (select bool_and(key ~ '^[A-Za-z0-9_-]{8,128}$') from public.partner_tello_links) as existing_keys_ok;
