const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('trainer', 'owner'));

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, title: data.title || 'Trainer' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ── Dashboard ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();

  if (!trainerRec) {
    return render(req, res, 'trainer/dashboard', {
      title: 'Dashboard',
      myMembers: [], upcomingSessions: [], memberCount: 0,
    });
  }

  const { data: assignments } = await supabase.from('trainer_assignments')
    .select('*, profiles!member_id(full_name)').eq('trainer_id', trainerRec.id).eq('is_active', true);

  const today = new Date().toISOString().split('T')[0];
  const { data: sessions } = await supabase.from('sessions')
    .select('*, profiles(full_name)')
    .eq('trainer_id', trainerRec.id)
    .eq('session_date', today)
    .in('status', ['scheduled']);

  render(req, res, 'trainer/dashboard', {
    title: 'Dashboard',
    myMembers: assignments || [],
    upcomingSessions: sessions || [],
    memberCount: assignments?.length || 0,
    trainerRec,
  });
});

// ── My Members ─────────────────────────────────────────────
router.get('/members', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();

  if (!trainerRec) {
    return render(req, res, 'trainer/members', { title: 'My Members', members: [] });
  }

  const { data: assignments } = await supabase.from('trainer_assignments')
    .select('*, profiles!member_id(*), memberships(*)')
    .eq('trainer_id', trainerRec.id)
    .eq('is_active', true);

  render(req, res, 'trainer/members', { title: 'My Members', members: assignments || [] });
});

router.get('/members/:id', async (req, res) => {
  const { data: member } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
  const { data: progress } = await supabase.from('member_progress')
    .select('*').eq('member_id', req.params.id).order('recorded_at', { ascending: false }).limit(20);
  const today = new Date().toISOString().split('T')[0];
  const { data: todayWorkout } = await supabase.from('assigned_workouts')
    .select('*, workout_templates(*)').eq('member_id', req.params.id).eq('assigned_date', today).single();

  render(req, res, 'trainer/member_detail', {
    title: member?.full_name || 'Member',
    member, progress: progress || [], todayWorkout,
  });
});

// ── Progress Recording ─────────────────────────────────────
router.post('/members/:id/progress', async (req, res) => {
  const { weight_kg, body_fat_pct, waist_cm, notes } = req.body;
  await supabase.from('member_progress').insert({
    member_id: req.params.id,
    recorded_by: res.locals.user.id,
    weight_kg: parseFloat(weight_kg) || null,
    body_fat_pct: parseFloat(body_fat_pct) || null,
    waist_cm: parseFloat(waist_cm) || null,
    notes,
  });
  res.setHeader('HX-Redirect', `/trainer/members/${req.params.id}`);
  res.send('');
});

// ── Workout Templates ──────────────────────────────────────
router.get('/workouts', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();

  if (!trainerRec) {
    return render(req, res, 'trainer/workouts', { title: 'Workout Templates', templates: [], members: [] });
  }

  const { data: templates } = await supabase.from('workout_templates')
    .select('*').eq('trainer_id', trainerRec.id).order('created_at', { ascending: false });

  const { data: assignments } = await supabase.from('trainer_assignments')
    .select('*, profiles!member_id(full_name)').eq('trainer_id', trainerRec.id).eq('is_active', true);

  render(req, res, 'trainer/workouts', {
    title: 'Workout Templates',
    templates: templates || [],
    members: assignments || [],
    trainerRec,
  });
});

router.post('/workouts', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();
  if (!trainerRec) return res.send('Trainer not found');

  const { name, description } = req.body;
  const exercises = [];
  const exerciseNames = req.body.exercise_name || [];
  const exerciseSets = req.body.exercise_sets || [];
  const exerciseReps = req.body.exercise_reps || [];

  for (let i = 0; i < exerciseNames.length; i++) {
    if (exerciseNames[i]) {
      exercises.push({ name: exerciseNames[i], sets: exerciseSets[i] || '', reps: exerciseReps[i] || '' });
    }
  }

  await supabase.from('workout_templates').insert({
    trainer_id: trainerRec.id, name, description, exercises,
  });

  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

router.post('/workouts/assign', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();
  if (!trainerRec) return res.send('Trainer not found');

  const { template_id, member_id } = req.body;

  await supabase.from('assigned_workouts').insert({
    member_id, template_id, assigned_by: trainerRec.id,
    assigned_date: new Date().toISOString().split('T')[0],
  });

  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ── Schedule ───────────────────────────────────────────────
router.get('/schedule', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();
  if (!trainerRec) {
    return render(req, res, 'trainer/schedule', { title: 'Schedule', sessions: [] });
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: sessions } = await supabase.from('sessions')
    .select('*, profiles(full_name)')
    .eq('trainer_id', trainerRec.id)
    .gte('session_date', today)
    .order('session_date', { ascending: true })
    .order('start_time', { ascending: true });

  render(req, res, 'trainer/schedule', { title: 'Schedule', sessions: sessions || [] });
});

router.post('/schedule', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();
  if (!trainerRec) return res.send('Trainer not found');

  const { member_id, session_date, start_time, notes } = req.body;
  await supabase.from('sessions').insert({
    trainer_id: trainerRec.id, member_id, session_date, start_time, notes,
    status: 'scheduled',
  });

  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ── Progress View ──────────────────────────────────────────
router.get('/progress', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();
  if (!trainerRec) {
    return render(req, res, 'trainer/progress', { title: 'Member Progress', members: [] });
  }

  const { data: assignments } = await supabase.from('trainer_assignments')
    .select('*, profiles!member_id(*)')
    .eq('trainer_id', trainerRec.id)
    .eq('is_active', true);

  const memberIds = assignments?.map(a => a.member_id) || [];
  const { data: progressRecords } = memberIds.length > 0
    ? await supabase.from('member_progress').select('*').in('member_id', memberIds).order('recorded_at', { ascending: false }).limit(50)
    : { data: [] };

  const members = assignments?.map(a => ({
    ...a.profiles,
    progress: (progressRecords || []).filter(p => p.member_id === a.member_id).slice(0, 5),
  })) || [];

  render(req, res, 'trainer/progress', { title: 'Member Progress', members });
});

// ── My Classes ─────────────────────────────────────────────
router.get('/classes', async (req, res) => {
  const trainer = res.locals.user;
  const { data: trainerRec } = await supabase.from('trainers').select('*').eq('profile_id', trainer.id).single();

  if (!trainerRec) {
    return render(req, res, 'trainer/classes', { title: 'My Classes', schedules: [] });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: schedules } = await supabase.from('class_schedules')
    .select('*, classes(name, category), class_bookings(count)')
    .eq('trainer_id', trainerRec.id)
    .gte('schedule_date', today)
    .order('schedule_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(30);

  const { data: pastSchedules } = await supabase.from('class_schedules')
    .select('*, classes(name, category)')
    .eq('trainer_id', trainerRec.id)
    .lt('schedule_date', today)
    .order('schedule_date', { ascending: false })
    .limit(10);

  render(req, res, 'trainer/classes', {
    title: 'My Classes',
    schedules: schedules || [],
    pastSchedules: pastSchedules || [],
  });
});

module.exports = router;
