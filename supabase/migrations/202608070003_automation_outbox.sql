create extension if not exists pg_cron with schema pg_catalog;

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null check (kind in ('learning_reminder','certificate_expiry','knowledge_feedback')),
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_outbox_delivery_idx
  on public.notification_outbox(status,scheduled_for);
create index notification_outbox_org_user_idx
  on public.notification_outbox(org_id,user_id,created_at desc);

alter table public.notification_outbox enable row level security;

create policy notification_outbox_deny_anon
  on public.notification_outbox for all to anon using (false) with check (false);
create policy notification_outbox_deny_authenticated
  on public.notification_outbox for all to authenticated using (false) with check (false);

create or replace function public.enqueue_onework_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  current_count integer := 0;
begin
  insert into public.notification_outbox(org_id,user_id,kind,subject,payload,scheduled_for)
  select e.org_id,e.user_id,'learning_reminder',
    'Continue your required OneWork training',
    jsonb_build_object('module_id',m.id,'module_code',m.code,'module_title',m.title,'status',e.status),
    now()
  from public.enrollments e
  join public.training_modules m on m.id=e.module_id and m.org_id=e.org_id
  where e.status in ('assigned','in_progress')
    and e.updated_at < now() - interval '7 days'
    and not exists (
      select 1 from public.notification_outbox n
      where n.org_id=e.org_id and n.user_id=e.user_id and n.kind='learning_reminder'
        and n.payload->>'module_id'=m.id::text and n.created_at::date=current_date
    );
  get diagnostics current_count = row_count;
  inserted_count := inserted_count + current_count;

  insert into public.notification_outbox(org_id,user_id,kind,subject,payload,scheduled_for)
  select c.org_id,c.user_id,'certificate_expiry',
    'Your OneWork certificate is approaching expiry',
    jsonb_build_object('certificate_id',c.id,'certificate_number',c.certificate_number,'expires_at',c.expires_at,'module_title',m.title),
    now()
  from public.certificates c
  join public.training_modules m on m.id=c.module_id and m.org_id=c.org_id
  where c.expires_at between current_date and current_date + 60
    and not exists (
      select 1 from public.notification_outbox n
      where n.org_id=c.org_id and n.user_id=c.user_id and n.kind='certificate_expiry'
        and n.payload->>'certificate_id'=c.id::text and n.created_at::date=current_date
    );
  get diagnostics current_count = row_count;
  inserted_count := inserted_count + current_count;
  return inserted_count;
end;
$$;

revoke all on function public.enqueue_onework_reminders() from public,anon,authenticated;
grant execute on function public.enqueue_onework_reminders() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname='onework-daily-reminders') then
    perform cron.unschedule('onework-daily-reminders');
  end if;
  perform cron.schedule(
    'onework-daily-reminders',
    '30 2 * * *',
    'select public.enqueue_onework_reminders();'
  );
end
$$;
