create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'nurse' check (role in ('nurse', 'pharmacist', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_name text,
  bed text,
  medication_name text not null,
  input_summary text not null,
  result_summary text not null,
  reviewed boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prescription_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text,
  raw_ocr_text text,
  extracted_data jsonb,
  confidence numeric,
  reviewed_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  medication_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, medication_name)
);

alter table public.profiles enable row level security;
alter table public.calculations enable row level security;
alter table public.prescription_scans enable row level security;
alter table public.user_favorites enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "calculations_own" on public.calculations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scans_own" on public.prescription_scans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "favorites_own" on public.user_favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'ผู้ใช้งาน'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('prescriptions', 'prescriptions', false)
on conflict (id) do nothing;

create policy "prescription_upload_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'prescriptions' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "prescription_read_own"
on storage.objects for select to authenticated
using (bucket_id = 'prescriptions' and (storage.foldername(name))[1] = auth.uid()::text);
