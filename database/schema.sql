-- ============================================================
-- GYM OS — Database Schema (Phase 1 MVP)
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. MEMBERSHIP PLANS
create table membership_plans (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  duration_months int not null default 1,
  price decimal(10,2) not null,
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 3. PROFILES (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  role text not null check (role in ('owner', 'reception', 'trainer', 'member')) default 'member',
  gym_id uuid,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. GYMS (for future multi-branch)
create table gyms (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  capacity int default 100,
  open_time time default '05:00',
  close_time time default '23:00',
  created_at timestamptz default now()
);

alter table profiles add constraint fk_profiles_gym foreign key (gym_id) references gyms(id);

-- 5. MEMBERSHIPS
create table memberships (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id),
  plan_id uuid references membership_plans(id),
  start_date date not null default current_date,
  end_date date not null,
  status text not null check (status in ('active', 'expired', 'frozen', 'cancelled')) default 'active',
  frozen_until date,
  transferred_from uuid references profiles(id),
  price_paid decimal(10,2),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. PAYMENTS
create table payments (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id),
  membership_id uuid references memberships(id),
  amount decimal(10,2) not null,
  payment_method text check (payment_method in ('cash', 'card', 'upi', 'bank_transfer')) default 'cash',
  payment_type text check (payment_type in ('new_admission', 'renewal', 'upgrade', 'other')) default 'new_admission',
  collected_by uuid references profiles(id),
  receipt_number text,
  notes text,
  created_at timestamptz default now()
);

-- 7. ATTENDANCE
create table attendance (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id),
  gym_id uuid references gyms(id),
  check_in timestamptz not null default now(),
  check_out timestamptz,
  duration_minutes int generated always as (
    case when check_out is not null
      then extract(epoch from (check_out - check_in)) / 60
      else null
    end
  ) stored,
  created_at timestamptz default now()
);

-- 8. TRAINERS
create table trainers (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) unique,
  bio text,
  specializations text[],
  max_members int default 15,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 9. TRAINER ASSIGNMENTS
create table trainer_assignments (
  id uuid primary key default uuid_generate_v4(),
  trainer_id uuid not null references trainers(id),
  member_id uuid not null references profiles(id),
  assigned_at timestamptz default now(),
  is_active boolean default true
);

-- 10. WORKOUT TEMPLATES
create table workout_templates (
  id uuid primary key default uuid_generate_v4(),
  trainer_id uuid not null references trainers(id),
  name text not null,
  description text,
  exercises jsonb not null default '[]',
  created_at timestamptz default now()
);

-- 11. ASSIGNED WORKOUTS
create table assigned_workouts (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id),
  template_id uuid references workout_templates(id),
  assigned_by uuid references trainers(id),
  assigned_date date default current_date,
  notes text,
  is_completed boolean default false,
  created_at timestamptz default now()
);

-- 12. MEMBER PROGRESS
create table member_progress (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id),
  recorded_by uuid references profiles(id),
  weight_kg decimal(5,2),
  body_fat_pct decimal(4,1),
  waist_cm decimal(5,2),
  photo_url text,
  notes text,
  recorded_at timestamptz default now()
);

-- 13. CLASSES / SESSIONS
create table sessions (
  id uuid primary key default uuid_generate_v4(),
  trainer_id uuid not null references trainers(id),
  member_id uuid not null references profiles(id),
  session_date date not null,
  start_time time not null,
  end_time time,
  status text check (status in ('scheduled', 'completed', 'cancelled', 'no_show')) default 'scheduled',
  notes text,
  created_at timestamptz default now()
);

-- 14. NOTIFICATIONS
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id),
  title text not null,
  message text not null,
  type text check (type in ('membership', 'payment', 'appointment', 'general', 'offer')) default 'general',
  is_read boolean default false,
  created_at timestamptz default now()
);

-- 15. AUDIT LOG
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb default '{}',
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_memberships_member on memberships(member_id);
create index idx_memberships_status on memberships(status);
create index idx_memberships_end_date on memberships(end_date);
create index idx_attendance_member on attendance(member_id);
create index idx_attendance_check_in on attendance(check_in);
create index idx_attendance_gym_date on attendance(gym_id, check_in);
create index idx_payments_member on payments(member_id);
create index idx_payments_created on payments(created_at);
create index idx_notifications_user on notifications(user_id, is_read);
create index idx_assigned_workouts_member on assigned_workouts(member_id, assigned_date);
create index idx_sessions_date on sessions(session_date);
create index idx_trainer_assignments_member on trainer_assignments(member_id);

-- ============================================================
-- RLS POLICIES
-- ============================================================
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table payments enable row level security;
alter table attendance enable row level security;
alter table assigned_workouts enable row level security;
alter table member_progress enable row level security;
alter table sessions enable row level security;
alter table notifications enable row level security;
alter table trainer_assignments enable row level security;

-- Profiles: users can read their own, staff can read all
create policy "Users read own profile" on profiles
  for select using (auth.uid() = id);

create policy "Staff read all profiles" on profiles
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('owner', 'reception'))
  );

-- Memberships: members read own, staff all
create policy "Members read own membership" on memberships
  for select using (member_id = auth.uid());

create policy "Staff read all memberships" on memberships
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

create policy "Staff manage memberships" on memberships
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

-- Payments
create policy "Members read own payments" on payments
  for select using (member_id = auth.uid());

create policy "Staff read all payments" on payments
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

create policy "Staff insert payments" on payments
  for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

-- Attendance
create policy "Members read own attendance" on attendance
  for select using (member_id = auth.uid());

create policy "Staff read all attendance" on attendance
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

create policy "Members insert attendance" on attendance
  for insert with check (member_id = auth.uid());

create policy "Members update own attendance" on attendance
  for update using (member_id = auth.uid());

-- Notifications: users read own
create policy "Users read own notifications" on notifications
  for select using (user_id = auth.uid());

-- Trainer assignments
create policy "Trainer read own assignments" on trainer_assignments
  for select using (trainer_id in (select id from trainers where profile_id = auth.uid()));

create policy "Member read own trainer" on trainer_assignments
  for select using (member_id = auth.uid());

create policy "Staff manage assignments" on trainer_assignments
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

-- Assigned workouts
create policy "Members read own workouts" on assigned_workouts
  for select using (member_id = auth.uid());

create policy "Trainer manage workouts" on assigned_workouts
  for all using (
    assigned_by in (select id from trainers where profile_id = auth.uid())
    or exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

-- Progress
create policy "Members read own progress" on member_progress
  for select using (member_id = auth.uid());

create policy "Trainer record progress" on member_progress
  for insert with check (
    recorded_by = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  );

-- Sessions
create policy "Users read own sessions" on sessions
  for select using (member_id = auth.uid() or trainer_id in (select id from trainers where profile_id = auth.uid()));

create policy "Staff manage sessions" on sessions
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
    or trainer_id in (select id from trainers where profile_id = auth.uid())
  );

-- ============================================================
-- PHASE 2: CLASSES & MULTI-BRANCH
-- ============================================================

-- 16. GROUP CLASSES
create table classes (
  id uuid primary key default uuid_generate_v4(),
  gym_id uuid references gyms(id),
  name text not null,
  description text,
  category text check (category in ('yoga', 'hiit', 'strength', 'cardio', 'dance', 'cycling', 'pilates', 'other')) default 'other',
  default_duration_minutes int default 60,
  max_capacity int default 20,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 17. CLASS SCHEDULES (specific time slots)
create table class_schedules (
  id uuid primary key default uuid_generate_v4(),
  class_id uuid not null references classes(id) on delete cascade,
  trainer_id uuid references trainers(id),
  gym_id uuid references gyms(id),
  schedule_date date not null,
  start_time time not null,
  end_time time,
  capacity int default 20,
  booked_count int default 0,
  status text check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')) default 'scheduled',
  created_at timestamptz default now()
);

-- 18. CLASS BOOKINGS
create table class_bookings (
  id uuid primary key default uuid_generate_v4(),
  schedule_id uuid not null references class_schedules(id) on delete cascade,
  member_id uuid not null references profiles(id),
  status text check (status in ('booked', 'attended', 'no_show', 'cancelled')) default 'booked',
  booked_at timestamptz default now(),
  unique(schedule_id, member_id)
);

-- Gym-aware attendance (add gym_id if not already set via QR)
alter table attendance alter column gym_id drop not null;

-- RLS: Classes
alter table classes enable row level security;
alter table class_schedules enable row level security;
alter table class_bookings enable row level security;

create policy "Anyone read classes" on classes for select using (true);
create policy "Owner manage classes" on classes for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

create policy "Anyone read schedules" on class_schedules for select using (true);
create policy "Owner manage schedules" on class_schedules for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
  or trainer_id in (select id from trainers where profile_id = auth.uid())
);

create policy "Members read own bookings" on class_bookings for select using (member_id = auth.uid());
create policy "Members insert bookings" on class_bookings for insert with check (member_id = auth.uid());
create policy "Members update own bookings" on class_bookings for update using (member_id = auth.uid());
create policy "Staff manage bookings" on class_bookings for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

-- Indexes for Phase 2
create index idx_class_schedules_date on class_schedules(schedule_date);
create index idx_class_schedules_gym on class_schedules(gym_id);
create index idx_class_bookings_member on class_bookings(member_id);
create index idx_class_bookings_schedule on class_bookings(schedule_id);

-- ============================================================
-- PHASE 3: ANALYTICS & INSIGHTS
-- ============================================================

-- 19. DAILY ANALYTICS SNAPSHOTS
create table analytics_snapshots (
  id uuid primary key default uuid_generate_v4(),
  gym_id uuid references gyms(id),
  snapshot_date date not null default current_date,
  total_checkins int default 0,
  unique_members int default 0,
  peak_hour int,
  peak_count int,
  avg_duration_minutes decimal(6,1),
  total_revenue decimal(12,2) default 0,
  new_members int default 0,
  renewals int default 0,
  churned int default 0,
  active_members int default 0,
  capacity_pct decimal(4,1),
  created_at timestamptz default now(),
  unique(gym_id, snapshot_date)
);

-- 20. MEMBER INSIGHTS
create table member_insights (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id) unique,
  churn_risk text check (churn_risk in ('low', 'medium', 'high')) default 'low',
  churn_factors jsonb default '[]',
  last_visit date,
  visit_streak_days int default 0,
  avg_visits_per_week decimal(4,1),
  avg_duration_minutes decimal(5,1),
  visit_trend text check (visit_trend in ('rising', 'stable', 'declining', 'inactive')) default 'stable',
  suggested_plan_id uuid references membership_plans(id),
  suggestion_reason text,
  days_since_last_visit int,
  updated_at timestamptz default now()
);

-- 21. AUTOMATION RULES (for marketing)
create table automation_rules (
  id uuid primary key default uuid_generate_v4(),
  gym_id uuid references gyms(id),
  name text not null,
  description text,
  trigger_type text not null check (trigger_type in (
    'membership_expiring', 'inactive_7_days', 'inactive_14_days',
    'birthday', 'payment_due', 'renewal_overdue', 'first_visit'
  )),
  action_type text not null check (action_type in ('notification', 'email', 'offer')),
  action_template text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- RLS for Phase 3
alter table analytics_snapshots enable row level security;
alter table member_insights enable row level security;
alter table automation_rules enable row level security;

create policy "Staff read analytics" on analytics_snapshots for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

create policy "Staff read insights" on member_insights for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

create policy "Member read own insights" on member_insights for select using (
  member_id = auth.uid()
);

create policy "Staff manage automation" on automation_rules for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

-- Indexes
create index idx_analytics_date on analytics_snapshots(snapshot_date);
create index idx_analytics_gym on analytics_snapshots(gym_id);
create index idx_insights_churn on member_insights(churn_risk);
create index idx_insights_member on member_insights(member_id);

-- ============================================================
-- PHASE 4: INTEGRATIONS & ADVANCED BI
-- ============================================================

-- 22. WEARABLE DATA
create table wearable_data (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id),
  source text default 'manual',
  recorded_date date not null default current_date,
  steps int,
  heart_rate_avg int,
  heart_rate_max int,
  calories_burned int,
  active_minutes int,
  sleep_hours decimal(3,1),
  weight_kg decimal(5,2),
  raw_data jsonb default '{}',
  created_at timestamptz default now()
);

-- 23. SMART GATE DEVICES
create table gate_devices (
  id uuid primary key default uuid_generate_v4(),
  gym_id uuid references gyms(id),
  name text not null,
  device_type text check (device_type in ('gate', 'turnstile', 'door', 'other')) default 'gate',
  location text,
  api_key text unique default gen_random_uuid()::text,
  is_active boolean default true,
  last_ping timestamptz,
  created_at timestamptz default now()
);

-- 24. GATE EVENTS (automated check-in/out)
create table gate_events (
  id uuid primary key default uuid_generate_v4(),
  device_id uuid references gate_devices(id),
  member_id uuid references profiles(id),
  event_type text check (event_type in ('entry', 'exit')) not null,
  access_granted boolean default true,
  access_denied_reason text,
  created_at timestamptz default now()
);

-- 25. FACE DATA
create table face_data (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references profiles(id) unique,
  photo_url text,
  face_encoding jsonb,
  is_verified boolean default false,
  registered_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 26. IOT SENSORS
create table iot_sensors (
  id uuid primary key default uuid_generate_v4(),
  gym_id uuid references gyms(id),
  name text not null,
  sensor_type text check (sensor_type in ('occupancy', 'temperature', 'humidity', 'noise', 'air_quality', 'energy')) default 'occupancy',
  location text,
  api_key text unique default gen_random_uuid()::text,
  is_active boolean default true,
  last_reading timestamptz,
  created_at timestamptz default now()
);

-- 27. SENSOR READINGS (time-series)
create table sensor_readings (
  id uuid primary key default uuid_generate_v4(),
  sensor_id uuid not null references iot_sensors(id),
  value decimal(10,2) not null,
  unit text default 'count',
  recorded_at timestamptz default now()
);

-- RLS Phase 4
alter table wearable_data enable row level security;
alter table gate_devices enable row level security;
alter table gate_events enable row level security;
alter table face_data enable row level security;
alter table iot_sensors enable row level security;
alter table sensor_readings enable row level security;

create policy "Member read own wearable" on wearable_data for select using (member_id = auth.uid());
create policy "Trainer read assigned wearable" on wearable_data for select using (
  member_id in (select member_id from trainer_assignments where trainer_id in (select id from trainers where profile_id = auth.uid()))
  or exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);
create policy "Staff insert wearable" on wearable_data for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception', 'trainer'))
);

create policy "Staff manage gates" on gate_devices for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);
create policy "Staff read gate events" on gate_events for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

create policy "Member read own face" on face_data for select using (member_id = auth.uid());
create policy "Staff manage face data" on face_data for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

create policy "Staff manage sensors" on iot_sensors for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);
create policy "Staff read readings" on sensor_readings for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'reception'))
);

-- Indexes
create index idx_wearable_member on wearable_data(member_id, recorded_date);
create index idx_gate_events_member on gate_events(member_id);
create index idx_gate_events_time on gate_events(created_at);
create index idx_sensor_readings_sensor on sensor_readings(sensor_id, recorded_at);
create index idx_sensor_readings_time on sensor_readings(recorded_at);

-- ============================================================
-- SEED DATA (Automation Rules)
-- ============================================================
insert into automation_rules (name, description, trigger_type, action_type, action_template) values
  ('Membership Expiring', 'Notify members 7 days before membership expires', 'membership_expiring', 'notification',
   'Your membership expires in 7 days. Renew now to continue uninterrupted access.'),
  ('Inactive Member', 'Re-engage members who have not visited in 7 days', 'inactive_7_days', 'notification',
   'We miss you! It has been a week since your last visit. Come back and crush your goals.'),
  ('Renewal Overdue', 'Alert members whose membership has expired', 'renewal_overdue', 'notification',
   'Your membership has expired. Renew today and get back to your routine.'),
  ('Welcome Offer', 'Send welcome notification on first visit', 'first_visit', 'notification',
   'Welcome to the gym! Your first workout has been logged. Let us know if you need any help.');

-- ============================================================
-- SEED DATA
-- ============================================================
insert into membership_plans (name, duration_months, price, description) values
  ('Monthly', 1, 1500, 'Standard monthly membership'),
  ('Quarterly', 3, 4000, '3-month membership with 10% discount'),
  ('Half-Yearly', 6, 7500, '6-month membership with 17% discount'),
  ('Annual', 12, 13500, '12-month membership with 25% discount'),
  ('Day Pass', 0, 300, 'Single day access pass'),
  ('Student Monthly', 1, 1000, 'Discounted monthly for students');
