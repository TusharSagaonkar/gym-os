const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();
router.use(requireAuth);

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, gym: res.locals.gym, title: data.title || 'Classes' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ── List all upcoming classes ──────────────────────────────
router.get('/', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const gymId = res.locals.gymId;
  const category = req.query.category || '';

  let query = supabase.from('class_schedules')
    .select('*, classes(*), trainers(*, profiles(full_name))')
    .gte('schedule_date', today)
    .eq('status', 'scheduled')
    .order('schedule_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (gymId) query = query.eq('gym_id', gymId);
  if (category && category !== 'all') query = query.eq('classes.category', category);

  const { data: schedules } = await query.limit(50);

  const { data: categories } = await supabase.from('classes')
    .select('category').eq('is_active', true);

  const uniqueCategories = ['all', ...new Set((categories || []).map(c => c.category))];

  render(req, res, 'shared/classes', {
    title: 'Classes',
    schedules: schedules || [],
    categories: uniqueCategories,
    selectedCategory: category || 'all',
    gymId,
  });
});

// ── Book a class ───────────────────────────────────────────
router.post('/:scheduleId/book', async (req, res) => {
  const memberId = res.locals.user.id;
  const { scheduleId } = req.params;

  const { data: existing } = await supabase.from('class_bookings')
    .select('*').eq('schedule_id', scheduleId).eq('member_id', memberId).single();

  if (existing) {
    if (req.headers['hx-request']) {
      return res.send('<div class="text-red-500 text-sm">Already booked.</div>');
    }
    return res.redirect('/classes');
  }

  const { data: schedule } = await supabase.from('class_schedules')
    .select('capacity, booked_count').eq('id', scheduleId).single();

  if (schedule && schedule.booked_count >= schedule.capacity) {
    if (req.headers['hx-request']) {
      return res.send('<div class="text-red-500 text-sm">Class is full.</div>');
    }
    return res.redirect('/classes');
  }

  await supabase.from('class_bookings').insert({ schedule_id: scheduleId, member_id: memberId });
  await supabase.from('class_schedules')
    .update({ booked_count: (schedule?.booked_count || 0) + 1 }).eq('id', scheduleId);

  if (req.headers['hx-request']) {
    return res.send('<div class="text-emerald-600 text-sm font-medium">✓ Booked!</div>');
  }
  res.redirect('/classes');
});

// ── Cancel a booking ───────────────────────────────────────
router.post('/:scheduleId/cancel', async (req, res) => {
  const memberId = res.locals.user.id;

  await supabase.from('class_bookings')
    .update({ status: 'cancelled' })
    .eq('schedule_id', req.params.scheduleId)
    .eq('member_id', memberId);

  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ── My bookings ────────────────────────────────────────────
router.get('/my-bookings', async (req, res) => {
  const memberId = res.locals.user.id;
  const today = new Date().toISOString().split('T')[0];

  const { data: bookings } = await supabase.from('class_bookings')
    .select('*, class_schedules(*, classes(name, category), trainers(*, profiles(full_name)))')
    .eq('member_id', memberId)
    .eq('status', 'booked')
    .gte('class_schedules.schedule_date', today)
    .order('class_schedules(schedule_date)', { ascending: true });

  const { data: pastBookings } = await supabase.from('class_bookings')
    .select('*, class_schedules(*, classes(name, category)))')
    .eq('member_id', memberId)
    .lte('class_schedules.schedule_date', today)
    .order('class_schedules(schedule_date)', { ascending: false })
    .limit(20);

  render(req, res, 'shared/my_classes', {
    title: 'My Classes',
    bookings: bookings || [],
    pastBookings: pastBookings || [],
  });
});

module.exports = router;
