const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('owner'));

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, title: data.title || 'Dashboard' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ── Dashboard ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [
    { count: membersInside },
    { count: trainerCount },
    { data: todayPayments },
    { data: monthPayments },
    { data: renewalsDue },
    { count: activeMembers },
    { count: expiringMembers },
    { data: attendanceToday },
    { data: peakHours },
  ] = await Promise.all([
    supabase.from('attendance').select('*', { count: 'exact', head: true }).is('check_out', null),
    supabase.from('trainers').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('payments').select('amount').gte('created_at', today),
    supabase.from('payments').select('amount').gte('created_at', monthStart),
    supabase.from('memberships').select('id').eq('status', 'active').lte('end_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('status', 'active').lte('end_date', new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]),
    supabase.from('attendance').select('check_in').gte('check_in', today + 'T00:00:00').lte('check_in', today + 'T23:59:59'),
    supabase.from('attendance').select('check_in').gte('check_in', today + 'T00:00:00').lte('check_in', today + 'T23:59:59'),
  ]);

  const todayTotal = todayPayments?.reduce((s, p) => s + Number(p.amount), 0) || 0;
  const monthTotal = monthPayments?.reduce((s, p) => s + Number(p.amount), 0) || 0;

  // Peak hour calculation
  const hours = attendanceToday?.reduce((acc, a) => {
    const h = new Date(a.check_in).getHours();
    acc[h] = (acc[h] || 0) + 1;
    return acc;
  }, {});
  let peakHour = null, peakCount = 0;
  if (hours) {
    for (const [h, c] of Object.entries(hours)) {
      if (c > peakCount) { peakCount = c; peakHour = h; }
    }
  }
  const peakDisplay = peakHour ? `${peakHour}:00` : '---';
  const capacityPct = Math.min(100, Math.round((membersInside || 0) / 100 * 100));

  // Smart suggestion
  const suggestion = generateSuggestion(hours, membersInside || 0);

  const stats = { membersInside, trainerCount, todayTotal, monthTotal, renewalsDue: renewalsDue?.length || 0, activeMembers, expiringMembers, capacityPct, peakDisplay, suggestion };

  render(req, res, 'owner/dashboard', { title: 'Dashboard', stats });
});

function generateSuggestion(hours, inside) {
  if (!hours) return null;
  const count113 = (hours['11'] || 0) + (hours['12'] || 0) + (hours['13'] || 0) + (hours['14'] || 0) + (hours['15'] || 0);
  const count68 = (hours['18'] || 0) + (hours['19'] || 0) + (hours['20'] || 0);

  if (count113 <= 5 && inside > 15) {
    return { type: 'opportunity', title: 'Launch a "Day Shift Membership"', description: '11 AM–3 PM has low occupancy. Offer a discounted day-time plan to fill idle hours.' };
  }
  if (count68 > 50) {
    return { type: 'capacity', title: 'Consider Premium Peak-Hour Memberships', description: '6 PM–8 PM is at near capacity. Increase trainer availability or introduce peak pricing.' };
  }
  return null;
}

// ── Members ────────────────────────────────────────────────
router.get('/members', async (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';

  let query = supabase.from('profiles').select('*, memberships!inner(*)').eq('role', 'member');

  if (search) query = query.ilike('full_name', `%${search}%`);
  if (status && status !== 'all') query = query.eq('memberships.status', status);

  const { data: members } = await query.order('created_at', { ascending: false }).limit(100);

  render(req, res, 'owner/members', { title: 'Members', members: members || [], search, status });
});

router.get('/members/:id', async (req, res) => {
  const { data: member } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
  const { data: memberships } = await supabase.from('memberships').select('*, membership_plans(name)').eq('member_id', req.params.id).order('created_at', { ascending: false });
  const { data: payments } = await supabase.from('payments').select('*').eq('member_id', req.params.id).order('created_at', { ascending: false }).limit(20);
  const { data: attendance } = await supabase.from('attendance').select('*').eq('member_id', req.params.id).order('check_in', { ascending: false }).limit(30);
  const { data: trainer } = await supabase.from('trainer_assignments').select('trainers(profile_id, profiles(full_name))').eq('member_id', req.params.id).eq('is_active', true).single();

  render(req, res, 'owner/member_detail', {
    title: member?.full_name || 'Member',
    member,
    memberships: memberships || [],
    payments: payments || [],
    attendance: attendance || [],
    trainer: trainer?.trainers,
  });
});

// ── Membership Actions (HTMX) ──────────────────────────────
router.post('/members/:id/renew', async (req, res) => {
  const { plan_id, amount, payment_method } = req.body;
  const memberId = req.params.id;
  const planDuration = parseInt(req.body.duration) || 1;
  const startDate = new Date().toISOString().split('T')[0];
  const endDate = new Date(Date.now() + planDuration * 30 * 86400000).toISOString().split('T')[0];

  const { data: membership } = await supabase.from('memberships').insert({
    member_id: memberId, plan_id, start_date: startDate, end_date: endDate,
    status: 'active', price_paid: amount,
  }).select().single();

  if (membership) {
    await supabase.from('payments').insert({
      member_id: memberId, membership_id: membership.id, amount,
      payment_method: payment_method || 'cash', payment_type: 'renewal',
      collected_by: res.locals.user.id,
      receipt_number: `RCP-${Date.now().toString(36).toUpperCase()}`,
    });
  }

  res.setHeader('HX-Redirect', `/owner/members/${memberId}`);
  res.send('');
});

router.post('/members/:id/freeze', async (req, res) => {
  const { until } = req.body;
  await supabase.from('memberships').update({ status: 'frozen', frozen_until: until })
    .eq('member_id', req.params.id).eq('status', 'active');

  res.setHeader('HX-Redirect', `/owner/members/${req.params.id}`);
  res.send('');
});

router.post('/members/:id/transfer', async (req, res) => {
  const { to_member_id } = req.body;
  await supabase.from('memberships').update({ status: 'cancelled', transferred_to: to_member_id })
    .eq('member_id', req.params.id).eq('status', 'active');

  const { data: currentMembership } = await supabase.from('memberships')
    .select('*').eq('member_id', req.params.id).eq('status', 'active').single();

  if (currentMembership) {
    await supabase.from('memberships').insert({
      member_id: to_member_id,
      plan_id: currentMembership.plan_id,
      start_date: new Date().toISOString().split('T')[0],
      end_date: currentMembership.end_date,
      status: 'active',
      transferred_from: req.params.id,
      price_paid: 0,
    });
  }

  res.setHeader('HX-Redirect', `/owner/members/${to_member_id}`);
  res.send('');
});

// ── Payments ───────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  const filter = req.query.filter || 'today';
  let query = supabase.from('payments').select('*, profiles!inner(full_name)').order('created_at', { ascending: false });

  if (filter === 'today') query = query.gte('created_at', new Date().toISOString().split('T')[0]);
  else if (filter === 'week') query = query.gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  else if (filter === 'month') query = query.gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  const { data: payments } = await query.limit(200);

  const total = payments?.reduce((s, p) => s + Number(p.amount), 0) || 0;

  render(req, res, 'owner/payments', { title: 'Payments', payments: payments || [], filter, total });
});

// ── Attendance ─────────────────────────────────────────────
router.get('/attendance', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const { data: logs } = await supabase.from('attendance')
    .select('*, profiles(full_name, phone)')
    .gte('check_in', date + 'T00:00:00')
    .lte('check_in', date + 'T23:59:59')
    .order('check_in', { ascending: false })
    .limit(200);

  const insideCount = logs?.filter(l => !l.check_out).length || 0;

  render(req, res, 'owner/attendance', { title: 'Attendance', logs: logs || [], date, insideCount });
});

// ── Trainers ───────────────────────────────────────────────
router.get('/trainers', async (req, res) => {
  const { data: trainers } = await supabase.from('trainers').select('*, profiles(full_name, phone, is_active)');
  const { data: assignments } = await supabase.from('trainer_assignments').select('trainer_id').eq('is_active', true);

  const trainerData = trainers?.map(t => ({
    ...t,
    memberCount: assignments?.filter(a => a.trainer_id === t.id).length || 0,
  })) || [];

  render(req, res, 'owner/trainers', { title: 'Trainers', trainers: trainerData });
});

// ── Reports ────────────────────────────────────────────────
router.get('/reports', async (req, res) => {
  const type = req.query.type || 'daily';
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  let startDate = today;
  if (type === 'weekly') startDate = weekAgo;
  if (type === 'monthly') startDate = monthStart;

  const [
    { data: payments },
    { data: attendance },
    { count: newMembers },
    { count: renewals },
    { count: churned },
  ] = await Promise.all([
    supabase.from('payments').select('amount, payment_type').gte('created_at', startDate),
    supabase.from('attendance').select('check_in').gte('check_in', startDate),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).gte('created_at', startDate),
    supabase.from('payments').select('*', { count: 'exact', head: true }).eq('payment_type', 'renewal').gte('created_at', startDate),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('status', 'expired').gte('updated_at', startDate),
  ]);

  const report = {
    totalRevenue: payments?.reduce((s, p) => s + Number(p.amount), 0) || 0,
    totalAttendance: attendance?.length || 0,
    newMembers: newMembers || 0,
    renewals: renewals || 0,
    churned: churned || 0,
    avgAttendance: (attendance?.length || 0) / (type === 'daily' ? 1 : type === 'weekly' ? 7 : 30),
  };

  render(req, res, 'owner/reports', { title: 'Reports', report, type });
});

// ── Plans ──────────────────────────────────────────────────
router.get('/plans', async (req, res) => {
  const { data: plans } = await supabase.from('membership_plans').select('*').order('price');
  render(req, res, 'owner/plans', { title: 'Membership Plans', plans: plans || [] });
});

router.post('/plans', async (req, res) => {
  const { name, duration_months, price, description } = req.body;
  await supabase.from('membership_plans').insert({ name, duration_months: parseInt(duration_months), price: parseFloat(price), description });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

router.put('/plans/:id', async (req, res) => {
  const { name, duration_months, price, description, is_active } = req.body;
  await supabase.from('membership_plans').update({
    name, duration_months: parseInt(duration_months), price: parseFloat(price), description,
    is_active: is_active === 'true',
  }).eq('id', req.params.id);
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ── Gym / Branch Management ────────────────────────────────
router.get('/gyms', async (req, res) => {
  const { data: gyms } = await supabase.from('gyms').select('*').order('created_at');
  render(req, res, 'owner/gyms', { title: 'Branches', gyms: gyms || [], activeGym: res.locals.gym });
});

router.post('/gyms', async (req, res) => {
  const { name, address, capacity, open_time, close_time } = req.body;
  await supabase.from('gyms').insert({
    name, address, capacity: parseInt(capacity) || 100,
    open_time: open_time || '05:00', close_time: close_time || '23:00',
  });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

router.get('/gyms/:id/switch', async (req, res) => {
  const { data: gym } = await supabase.from('gyms').select('*').eq('id', req.params.id).single();
  if (gym) {
    res.cookie('active_gym', gym.id, { maxAge: 30 * 86400000, httpOnly: true });
  }
  res.redirect('/owner');
});

// ── Class Management ───────────────────────────────────────
router.get('/classes', async (req, res) => {
  const gymId = res.locals.gymId;
  const { data: classes } = await supabase.from('classes').select('*')
    .eq(gymId ? 'gym_id' : 'id', gymId || '').order('name');
  const { data: trainers } = await supabase.from('trainers')
    .select('*, profiles(full_name)').eq('is_active', true);

  const today = new Date().toISOString().split('T')[0];
  let schedQuery = supabase.from('class_schedules')
    .select('*, classes(name, category), trainers(*, profiles(full_name))')
    .gte('schedule_date', today).order('schedule_date').order('start_time');

  if (gymId) schedQuery = schedQuery.eq('gym_id', gymId);

  const { data: schedules } = await schedQuery.limit(50);

  render(req, res, 'owner/classes', {
    title: 'Class Management',
    classes: classes || [],
    schedules: schedules || [],
    trainers: trainers || [],
    gymId,
  });
});

router.post('/classes', async (req, res) => {
  const { name, description, category, max_capacity, gym_id } = req.body;
  await supabase.from('classes').insert({
    name, description, category: category || 'other',
    max_capacity: parseInt(max_capacity) || 20,
    gym_id: gym_id || res.locals.gymId,
  });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

router.post('/classes/schedule', async (req, res) => {
  const { class_id, trainer_id, schedule_date, start_time, duration, capacity, gym_id } = req.body;
  const endHour = parseInt(start_time.split(':')[0]) + Math.floor((parseInt(duration) || 60) / 60);
  const endMin = parseInt(start_time.split(':')[1]) + ((parseInt(duration) || 60) % 60);
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

  await supabase.from('class_schedules').insert({
    class_id, trainer_id: trainer_id || null, schedule_date, start_time: start_time + ':00',
    end_time: endTime + ':00', capacity: parseInt(capacity) || 20,
    gym_id: gym_id || res.locals.gymId,
  });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ── Class bookings view ────────────────────────────────────
router.get('/classes/:scheduleId/bookings', async (req, res) => {
  const { data: bookings } = await supabase.from('class_bookings')
    .select('*, profiles(full_name, phone)')
    .eq('schedule_id', req.params.scheduleId)
    .eq('status', 'booked');

  render(req, res, 'owner/class_bookings', {
    title: 'Class Bookings',
    bookings: bookings || [],
    scheduleId: req.params.scheduleId,
  });
});

module.exports = router;
