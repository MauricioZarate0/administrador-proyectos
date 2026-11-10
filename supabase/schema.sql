-- Administrador de proyectos: esquema completo.
-- Pegar entero en Supabase > SQL Editor > Run. Se puede correr una sola vez.

create table public.settings (
  user_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  name         text not null default '',
  tax_id       text not null default '',
  address      text not null default '',
  email        text not null default '',
  phone        text not null default '',
  logo_path    text,
  next_receipt int  not null default 1 check (next_receipt > 0)
);

create table public.projects (
  id              bigint generated always as identity primary key,
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  kind            text not null default 'Web' check (length(trim(kind)) between 1 and 40),
  client          text not null default '',
  contact         text not null default '',
  url             text not null default '',
  status          text not null default 'activo' check (status in ('activo', 'desarrollo', 'pausado', 'finalizado')),
  currency        text not null default 'ARS' check (currency in ('ARS', 'USD')),
  fee             numeric(14,2) not null default 0 check (fee >= 0),
  due_day         int check (due_day between 1 and 31),
  start_date      date,
  domain_renewal  date,
  hosting_renewal date,
  notes           text not null default '',
  contract_path   text,
  icon            text check (icon is null or (icon like 'data:image/%' and length(icon) < 60000)),
  next_adjust     date,
  created_at      timestamptz not null default now()
);

create table public.payments (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  -- restrict: un proyecto con recibos no se borra (marcarlo "finalizado")
  project_id bigint not null references public.projects on delete restrict,
  paid_on    date not null default current_date,
  period     text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount     numeric(14,2) not null check (amount > 0),
  currency   text not null check (currency in ('ARS', 'USD')),
  receipt_no int  not null,
  pdf_path   text,
  note       text not null default '',
  voided_at  timestamptz,
  void_reason text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, receipt_no)
);
create index on public.payments (project_id);

alter table public.settings enable row level security;
alter table public.projects enable row level security;
alter table public.payments enable row level security;

create policy own on public.settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on public.projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Pagos: se crean solo vía register_payment (numeración atómica); acá leer/editar/borrar.
create policy own_select on public.payments for select to authenticated using (user_id = auth.uid());
create policy own_update on public.payments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_delete on public.payments for delete to authenticated using (user_id = auth.uid());

-- Asigna el próximo nº de recibo y crea el pago en una sola transacción.
-- El UPDATE bloquea la fila de settings, así dos dispositivos a la vez no repiten número.
create function public.register_payment(
  p_project bigint, p_paid_on date, p_period text, p_amount numeric, p_currency text, p_note text
) returns public.payments
language plpgsql security definer set search_path = '' as $$
declare
  n int;
  r public.payments;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not exists (select 1 from public.projects where id = p_project and user_id = auth.uid()) then
    raise exception 'Proyecto inexistente';
  end if;
  insert into public.settings (user_id) values (auth.uid()) on conflict do nothing;
  update public.settings set next_receipt = next_receipt + 1
    where user_id = auth.uid() returning next_receipt - 1 into n;
  insert into public.payments (user_id, project_id, paid_on, period, amount, currency, receipt_no, note)
    values (auth.uid(), p_project, p_paid_on, p_period, p_amount, p_currency, n, coalesce(p_note, ''))
    returning * into r;
  return r;
end $$;
revoke execute on function public.register_payment from public, anon;
grant execute on function public.register_payment to authenticated;

-- Archivos (recibos PDF y logo): bucket privado, cada usuario solo su carpeta <user_id>/...
insert into storage.buckets (id, name, public) values ('recibos', 'recibos', false)
  on conflict (id) do nothing;
create policy "recibos propios" on storage.objects for all to authenticated
  using (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Historial de cuota, aumento general y gastos (ver migrations/003).
-- Historial de cuota: lo llena el trigger, el usuario solo lo lee.
create table public.fee_changes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  project_id bigint not null references public.projects on delete cascade,
  changed_at timestamptz not null default now(),
  old_fee    numeric(14,2) not null,
  new_fee    numeric(14,2) not null
);
create index on public.fee_changes (project_id);
alter table public.fee_changes enable row level security;
create policy own_select on public.fee_changes for select to authenticated using (user_id = auth.uid());

create function public.log_fee_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fee_changes (user_id, project_id, old_fee, new_fee) values (new.user_id, new.id, old.fee, new.fee);
  return new;
end $$;
create trigger fee_change after update of fee on public.projects
  for each row when (new.fee is distinct from old.fee) execute function public.log_fee_change();

-- Aumento general: un solo UPDATE (todo o nada). Redondea a p_round (1, 100, 1000).
create function public.adjust_fees(p_projects bigint[], p_percent numeric, p_round numeric default 1)
returns setof public.projects language sql security invoker set search_path = '' as $$
  update public.projects
     set fee = round(fee * (1 + p_percent / 100) / p_round) * p_round
   where id = any(p_projects) and user_id = auth.uid() and fee > 0
  returning *;
$$;
revoke execute on function public.adjust_fees from public, anon;
grant execute on function public.adjust_fees to authenticated;

create table public.expenses (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  project_id bigint not null references public.projects on delete restrict,
  spent_on   date not null default current_date,
  concept    text not null check (length(trim(concept)) > 0),
  amount     numeric(14,2) not null check (amount > 0),
  currency   text not null check (currency in ('ARS', 'USD')),
  created_at timestamptz not null default now()
);
create index on public.expenses (project_id);
alter table public.expenses enable row level security;
create policy own on public.expenses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tareas por proyecto y suscripciones propias (ver migrations/005).
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
