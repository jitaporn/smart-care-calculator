create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  generic text,
  group_name text,
  routes text,
  max_dose numeric,
  max_dose_unit text,
  warning text,
  nursing text,
  source text,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'approved', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, generic, routes)
);

create index if not exists medications_status_name_idx
on public.medications (status, name);

alter table public.medications enable row level security;

drop policy if exists "medications_select_approved" on public.medications;
create policy "medications_select_approved"
on public.medications for select
to authenticated
using (status = 'approved');

drop policy if exists "medications_admin_manage" on public.medications;
create policy "medications_admin_manage"
on public.medications for all
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'pharmacist')
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'pharmacist')
  )
);

create or replace function public.touch_medications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists medications_touch_updated_at on public.medications;
create trigger medications_touch_updated_at
  before update on public.medications
  for each row execute procedure public.touch_medications_updated_at();
