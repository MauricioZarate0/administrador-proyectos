-- Tipo de proyecto libre (antes solo web/app/otro). Correr una vez en Supabase > SQL Editor.
alter table public.projects drop constraint if exists projects_kind_check;
update public.projects set kind = case kind when 'web' then 'Web' when 'app' then 'App' when 'otro' then 'Otro' else kind end;
alter table public.projects alter column kind set default 'Web';
alter table public.projects add constraint projects_kind_check check (length(trim(kind)) between 1 and 40);
