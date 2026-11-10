-- Contrato por proyecto, anulación de recibos, historial/aumento de cuotas y gastos.
-- Correr una vez en Supabase > SQL Editor.

alter table public.projects add column contract_path text, add column next_adjust date;
alter table public.payments add column voided_at timestamptz, add column void_reason text not null default '';

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
