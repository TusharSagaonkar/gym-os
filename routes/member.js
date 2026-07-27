const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('member'));

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, title: data.title || 'Home' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ── Home ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const member = res.locals.user;
  const today = new Date().toISOString().split('T')[0];

  const { data: membership } = await supabase.from('memberships')
    .select('*, membership_plans(name)')
    .eq('member_id', member.id)
    .eq('status', 'active')
    .single();

  const { data: trainerAssignment } = await supabase.from('trainer_assignments')
    .select('*, trainers(*, profiles(full_name))')
    .eq('member_id', member.id)
    .eq('is_active', true)
    .single();

  const { data: todayWorkout } = await supabase.from('assigned_workouts')
    .select('*, workout_templates(*)')
    .eq('member_id', member.id)
    .eq('assigned_date', today)
    .single();

  // Gym busy status
  const { count: insideCount } = await supabase.from('attendance')
    .select('*', { count: 'exact', head: true }).is('check_out', null);

  let busyLevel = 'Quiet';
  let busyColor = 'text-emerald-600';
  if ((insideCount || 0) > 30) { busyLevel = 'Busy'; busyColor = 'text-amber-600'; }
  if ((insideCount || 0) > 50) { busyLevel = 'Packed'; busyColor = 'text-red-600'; }

  // Greeting
  const hour = new Date().getHours();
  let greeting = 'Good Morning';
  if (hour >= 12 && hour < 17) greeting = 'Good Afternoon';
  if (hour >= 17) greeting = 'Good Evening';

  const { data: notifications } = await supabase.from('notifications')
    .select('*').eq('user_id', member.id).eq('is_read', false).order('created_at', { ascending: false }).limit(5);

  render(req, res, 'member/home', {
    title: 'Home',
    greeting, membership, trainer: trainerAssignment?.trainers,
    todayWorkout, busyLevel, busyColor, insideCount: insideCount || 0,
    unreadNotifications: notifications?.length || 0,
  });
});

// ── QR Check-in ────────────────────────────────────────────
router.get('/qr', async (req, res) => {
  const QRCode = require('qrcode');
  const memberId = res.locals.user.id;
  const qrData = JSON.stringify({ type: 'checkin', member_id: memberId, gym: 'default' });
  const qrSvg = await QRCode.toString(qrData, { type: 'svg', width: 220 });

  render(req, res, 'member/qr', { title: 'QR Check-in', qrSvg });
});

router.post('/check-in', async (req, res) => {
  const member = res.locals.user;

  const { data: activeAttendance } = await supabase.from('attendance')
    .select('*').eq('member_id', member.id).is('check_out', null).single();

  if (activeAttendance) {
    await supabase.from('attendance').update({ check_out: new Date().toISOString() })
      .eq('id', activeAttendance.id);

    if (req.headers['hx-request']) {
      return res.render('member/_checkin_result', {
        type: 'checkout',
        message: 'Checked Out. See you next time!',
        time: new Date().toLocaleTimeString('en-IN'),
      });
    }
  }

  await supabase.from('attendance').insert({ member_id: member.id, check_in: new Date().toISOString() });

  if (req.headers['hx-request']) {
    return res.render('member/_checkin_result', {
      type: 'checkin',
      message: 'Checked In. Enjoy your workout!',
      time: new Date().toLocaleTimeString('en-IN'),
    });
  }

  render(req, res, 'member/qr', { title: 'QR Check-in', qrSvg: '' });
});

// ── Workout ────────────────────────────────────────────────
router.get('/workout', async (req, res) => {
  const member = res.locals.user;
  const today = new Date().toISOString().split('T')[0];

  const { data: todayWorkout } = await supabase.from('assigned_workouts')
    .select('*, workout_templates(*)')
    .eq('member_id', member.id)
    .eq('assigned_date', today)
    .single();

  const { data: recentWorkouts } = await supabase.from('assigned_workouts')
    .select('*, workout_templates(name)')
    .eq('member_id', member.id)
    .order('assigned_date', { ascending: false })
    .limit(7);

  render(req, res, 'member/workout', {
    title: "Today's Workout",
    todayWorkout,
    recentWorkouts: recentWorkouts || [],
    exercises: todayWorkout?.workout_templates?.exercises || [],
  });
});

router.post('/workout/:id/complete', async (req, res) => {
  await supabase.from('assigned_workouts').update({ is_completed: true }).eq('id', req.params.id);
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ── Progress ───────────────────────────────────────────────
router.get('/progress', async (req, res) => {
  const member = res.locals.user;
  const { data: progress } = await supabase.from('member_progress')
    .select('*').eq('member_id', member.id).order('recorded_at', { ascending: false }).limit(30);

  const { data: wearable } = await supabase.from('wearable_data')
    .select('*').eq('member_id', member.id).order('recorded_date', { ascending: false }).limit(7);

  const latest = progress?.[0] || null;
  const latestWearable = wearable?.[0] || null;

  render(req, res, 'member/progress', {
    title: 'My Progress',
    progress: progress || [],
    latest,
    wearable: wearable || [],
    latestWearable,
  });
});

// ── Membership ─────────────────────────────────────────────
router.get('/membership', async (req, res) => {
  const member = res.locals.user;
  const { data: memberships } = await supabase.from('memberships')
    .select('*, membership_plans(name)')
    .eq('member_id', member.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: payments } = await supabase.from('payments')
    .select('*').eq('member_id', member.id).order('created_at', { ascending: false }).limit(20);

  const active = memberships?.find(m => m.status === 'active');
  const daysLeft = active ? Math.ceil((new Date(active.end_date) - new Date()) / 86400000) : 0;

  render(req, res, 'member/membership', {
    title: 'My Membership',
    memberships: memberships || [],
    active,
    daysLeft,
    payments: payments || [],
  });
});

// ── Bookings ───────────────────────────────────────────────
router.get('/bookings', async (req, res) => {
  const member = res.locals.user;
  const { data: sessions } = await supabase.from('sessions')
    .select('*, trainers(*, profiles(full_name))')
    .eq('member_id', member.id)
    .order('session_date', { ascending: true })
    .limit(20);

  render(req, res, 'member/bookings', {
    title: 'My Bookings',
    sessions: sessions || [],
  });
});

// ── Notifications ──────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  const member = res.locals.user;
  const { data: notifications } = await supabase.from('notifications')
    .select('*').eq('user_id', member.id).order('created_at', { ascending: false }).limit(50);

  render(req, res, 'member/notifications', {
    title: 'Notifications',
    notifications: notifications || [],
  });
});

router.post('/notifications/:id/read', async (req, res) => {
  await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
  res.send('');
});

module.exports = router;
