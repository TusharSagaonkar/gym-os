const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('reception', 'owner'));

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, title: data.title || 'Reception' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ── Search Member (main screen) ────────────────────────────
router.get('/', async (req, res) => {
  const search = req.query.search || '';
  let members = [];
  if (search.length >= 2) {
    const { data } = await supabase.from('profiles')
      .select('*, memberships(*, membership_plans(name))')
      .eq('role', 'member')
      .or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`)
      .limit(10);
    members = data || [];
  }
  render(req, res, 'reception/index', { title: 'Reception', members, search });
});

// ── All Members ────────────────────────────────────────────
router.get('/members', async (req, res) => {
  const { data: members } = await supabase.from('profiles')
    .select('*, memberships(*, membership_plans(name))')
    .eq('role', 'member')
    .order('created_at', { ascending: false })
    .limit(100);
  render(req, res, 'reception/members', { title: 'All Members', members: members || [] });
});

// ── New Admission ──────────────────────────────────────────
router.get('/new-admission', async (req, res) => {
  const { data: plans } = await supabase.from('membership_plans').select('*').eq('is_active', true).order('price');
  render(req, res, 'reception/new_admission', { title: 'New Admission', plans: plans || [] });
});

router.post('/new-admission', async (req, res) => {
  const { full_name, email, phone, password, plan_id, amount, payment_method } = req.body;

  const { data: authUser, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });

  if (error) {
    const { data: plans } = await supabase.from('membership_plans').select('*').eq('is_active', true).order('price');
    return render(req, res, 'reception/new_admission', {
      title: 'New Admission', plans: plans || [],
      error: error.message || 'Failed to create member.',
    });
  }

  const userId = authUser.user.id;
  await supabase.from('profiles').insert({ id: userId, full_name, phone, role: 'member' });

  const planDuration = parseInt(req.body.duration_months) || 1;
  const startDate = new Date().toISOString().split('T')[0];
  const endDate = new Date(Date.now() + planDuration * 30 * 86400000).toISOString().split('T')[0];

  const { data: membership } = await supabase.from('memberships').insert({
    member_id: userId, plan_id, start_date: startDate, end_date: endDate,
    status: 'active', price_paid: amount,
  }).select().single();

  const receipt = `RCP-${Date.now().toString(36).toUpperCase()}`;

  if (membership) {
    await supabase.from('payments').insert({
      member_id: userId, membership_id: membership.id, amount,
      payment_method: payment_method || 'cash', payment_type: 'new_admission',
      collected_by: res.locals.user.id, receipt_number: receipt,
    });
  }

  res.setHeader('HX-Trigger', JSON.stringify({ showReceipt: { name: full_name, amount, receipt, date: new Date().toLocaleDateString('en-IN') } }));
  render(req, res, 'reception/new_admission', {
    title: 'New Admission',
    plans: [],
    success: { name: full_name, amount, receipt },
  });
});

// ── QR Attendance ──────────────────────────────────────────
router.get('/attendance', (req, res) => {
  render(req, res, 'reception/attendance', { title: 'QR Check-in', result: null });
});

router.post('/attendance/check-in', async (req, res) => {
  const { member_id } = req.body;

  const { data: member } = await supabase.from('profiles').select('full_name').eq('id', member_id).single();
  if (!member) {
    render(req, res, 'reception/attendance', { title: 'QR Check-in', result: { error: 'Member not found.' } });
    return;
  }

  const { data: activeAttendance } = await supabase.from('attendance')
    .select('*').eq('member_id', member_id).is('check_out', null).single();

  if (activeAttendance) {
    await supabase.from('attendance').update({ check_out: new Date().toISOString() })
      .eq('id', activeAttendance.id);
    render(req, res, 'reception/attendance', {
      title: 'QR Check-in',
      result: { type: 'checkout', name: member.full_name, time: new Date().toLocaleTimeString('en-IN') },
    });
  } else {
    await supabase.from('attendance').insert({ member_id, check_in: new Date().toISOString() });
    render(req, res, 'reception/attendance', {
      title: 'QR Check-in',
      result: { type: 'checkin', name: member.full_name, time: new Date().toLocaleTimeString('en-IN') },
    });
  }
});

module.exports = router;
