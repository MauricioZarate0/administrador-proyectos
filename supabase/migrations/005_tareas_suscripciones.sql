-- Tareas por proyecto (lista "Por hacer" de los proyectos en desarrollo)
-- y suscripciones propias (Claude, hosting, etc.) con aviso de renovación.

create table public.tasks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  text       text not null check (length(trim(text)) between 1 and 500),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.tasks (project_id);
alter table public.tasks enable row level security;
create policy own on public.tasks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.subscriptions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  amount       numeric(14,2) not null default 0 check (amount >= 0),
  currency     text not null default 'USD' check (currency in ('ARS', 'USD')),
  cycle        text not null default 'mensual' check (cycle in ('mensual', 'anual')),
  next_renewal date not null,
  url          text not null default '',
  notes        text not null default '',
  created_at   timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy own on public.subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
