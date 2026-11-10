-- Ícono opcional por proyecto: imagen chica (96px) guardada como data URL.
alter table public.projects add column icon text
  check (icon is null or (icon like 'data:image/%' and length(icon) < 60000));
