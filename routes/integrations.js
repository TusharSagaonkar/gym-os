const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, gym: res.locals.gym, title: data.title || 'Integrations' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ══════════════════════════════════════════════════════════════
// GATE DEVICES — webhook for auto check-in/out via gates
// ══════════════════════════════════════════════════════════════

// Gate event webhook (called by gate hardware)
router.post('/gate/event', async (req, res) => {
  const { api_key, member_id, event_type } = req.body;

  const { data: device } = await supabase.from('gate_devices')
    .select('*').eq('api_key', api_key).eq('is_active', true).single();

  if (!device) return res.status(401).json({ error: 'Invalid device' });

  const { data: member } = await supabase.from('profiles').select('id').eq('id', member_id).single();
  if (!member) {
    await supabase.from('gate_events').insert({
      device_id: device.id, member_id, event_type: event_type || 'entry',
      access_granted: false, access_denied_reason: 'Unknown member',
    });
    return res.json({ access: false, reason: 'Unknown member' });
  }

  const { data: activeMembership } = await supabase.from('memberships')
    .select('*').eq('member_id', member_id).eq('status', 'active').single();

  if (!activeMembership) {
    await supabase.from('gate_events').insert({
      device_id: device.id, member_id, event_type: event_type || 'entry',
      access_granted: false, access_denied_reason: 'No active membership',
    });
    return res.json({ access: false, reason: 'No active membership' });
  }

  // Record gate event
  await supabase.from('gate_events').insert({
    device_id: device.id, member_id, event_type: event_type || 'entry', access_granted: true,
  });

  // Auto check-in/out
  if (event_type === 'entry') {
    const { data: alreadyIn } = await supabase.from('attendance')
      .select('*').eq('member_id', member_id).is('check_out', null).single();

    if (!alreadyIn) {
      await supabase.from('attendance').insert({
        member_id, check_in: new Date().toISOString(), gym_id: device.gym_id,
      });
    }
  } else if (event_type === 'exit') {
    const { data: active } = await supabase.from('attendance')
      .select('*').eq('member_id', member_id).is('check_out', null).single();
    if (active) {
      await supabase.from('attendance').update({ check_out: new Date().toISOString() })
        .eq('id', active.id);
    }
  }

  // Update last ping
  await supabase.from('gate_devices').update({ last_ping: new Date().toISOString() }).eq('id', device.id);

  res.json({ access: true, member: member_id, event: event_type });
});

// Gate management UI
router.get('/gates', requireAuth, requireRole('owner', 'reception'), async (req, res) => {
  const gymId = res.locals.gymId;
  const { data: devices } = await supabase.from('gate_devices').select('*')
    .eq(gymId ? 'gym_id' : 'id', gymId || '').order('created_at');
  const { data: events } = await supabase.from('gate_events')
    .select('*, gate_devices(name), profiles(full_name)')
    .order('created_at', { ascending: false }).limit(50);

  render(req, res, 'owner/gates', {
    title: 'Smart Gates',
    devices: devices || [],
    events: events || [],
  });
});

router.post('/gates/device', requireAuth, requireRole('owner', 'reception'), async (req, res) => {
  const { name, device_type, location } = req.body;
  await supabase.from('gate_devices').insert({
    name, device_type: device_type || 'gate', location, gym_id: res.locals.gymId,
  });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ══════════════════════════════════════════════════════════════
// IOT SENSORS — real-time occupancy via sensors
// ══════════════════════════════════════════════════════════════

// Sensor reading webhook
router.post('/sensors/reading', async (req, res) => {
  const { api_key, value, unit } = req.body;

  const { data: sensor } = await supabase.from('iot_sensors')
    .select('*').eq('api_key', api_key).eq('is_active', true).single();

  if (!sensor) return res.status(401).json({ error: 'Invalid sensor' });

  await supabase.from('sensor_readings').insert({
    sensor_id: sensor.id, value: parseFloat(value), unit: unit || 'count',
  });

  await supabase.from('iot_sensors').update({ last_reading: new Date().toISOString() }).eq('id', sensor.id);

  res.json({ ok: true });
});

// Current occupancy from sensors
router.get('/sensors/current', requireAuth, async (req, res) => {
  const gymId = res.locals.gymId;

  let query = supabase.from('iot_sensors').select('*').eq('sensor_type', 'occupancy').eq('is_active', true);
  if (gymId) query = query.eq('gym_id', gymId);

  const { data: sensors } = await query;

  const readings = [];
  if (sensors?.length > 0) {
    const { data: latest } = await supabase.from('sensor_readings')
      .select('*, iot_sensors!inner(name, location)')
      .in('sensor_id', sensors.map(s => s.id))
      .order('recorded_at', { ascending: false })
      .limit(sensors.length * 3);

    readings.push(...(latest || []));
  }

  res.json({
    occupancy: sensors?.reduce((sum, s) => {
      const latest = readings?.filter(r => r.sensor_id === s.id).sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];
      return sum + (latest ? parseFloat(latest.value) : 0);
    }, 0) || 0,
    sensors: sensors?.length || 0,
    readings: readings?.slice(0, 10),
  });
});

// Sensor management UI
router.get('/sensors', requireAuth, requireRole('owner', 'reception'), async (req, res) => {
  const gymId = res.locals.gymId;
  let query = supabase.from('iot_sensors').select('*').order('created_at');
  if (gymId) query = query.eq('gym_id', gymId);

  const { data: sensors } = await query;
  const { data: recentReadings } = await supabase.from('sensor_readings')
    .select('*, iot_sensors!inner(name)').order('recorded_at', { ascending: false }).limit(100);

  render(req, res, 'owner/sensors', {
    title: 'IoT Sensors',
    sensors: sensors || [],
    readings: recentReadings || [],
  });
});

router.post('/sensors/device', requireAuth, requireRole('owner', 'reception'), async (req, res) => {
  const { name, sensor_type, location } = req.body;
  await supabase.from('iot_sensors').insert({
    name, sensor_type: sensor_type || 'occupancy', location, gym_id: res.locals.gymId,
  });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

// ══════════════════════════════════════════════════════════════
// WEARABLE DATA
// ══════════════════════════════════════════════════════════════

router.post('/wearable', async (req, res) => {
  const { member_id, api_key, ...data } = req.body;

  // Optional API key check for external integrations
  await supabase.from('wearable_data').insert({
    member_id, ...data, recorded_date: new Date().toISOString().split('T')[0],
  });

  res.json({ ok: true });
});

// Member: get own wearable data
router.get('/wearable', requireAuth, async (req, res) => {
  const members = res.locals.user;
  const { data } = await supabase.from('wearable_data')
    .select('*').eq('member_id', members.id)
    .order('recorded_date', { ascending: false }).limit(30);

  res.json(data || []);
});

// ══════════════════════════════════════════════════════════════
// FACE RECOGNITION
// ══════════════════════════════════════════════════════════════

router.post('/face/register', requireAuth, async (req, res) => {
  const { photo_url } = req.body;
  if (!photo_url) return res.json({ ok: false, error: 'No photo provided' });

  await supabase.from('face_data').upsert({
    member_id: res.locals.user.id,
    photo_url,
    is_verified: true,
  }, { onConflict: 'member_id' });

  res.json({ ok: true });
});

router.post('/face/verify', async (req, res) => {
  const { member_id } = req.body;
  const { data } = await supabase.from('face_data')
    .select('*').eq('member_id', member_id).eq('is_verified', true).single();

  if (!data) return res.json({ match: false });

  res.json({ match: true, member_id: data.member_id, photo_url: data.photo_url });
});

// Face enrollment UI (reception)
router.get('/face', requireAuth, requireRole('owner', 'reception'), async (req, res) => {
  const { data: members } = await supabase.from('face_data')
    .select('*, profiles(full_name)').order('registered_at', { ascending: false }).limit(50);

  render(req, res, 'owner/faces', {
    title: 'Face Recognition',
    members: members || [],
  });
});

// ══════════════════════════════════════════════════════════════
// ADVANCED BUSINESS INTELLIGENCE
// ══════════════════════════════════════════════════════════════

router.get('/bi', requireAuth, requireRole('owner', 'reception'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0];
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0];
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];

  const [
    { data: thisMonthPayments },
    { data: lastMonthPayments },
    { data: thisMonthAttendance },
    { data: lastMonthAttendance },
    { count: thisMonthNew },
    { count: lastMonthNew },
    { count: activeNow },
    { count: activeLastMonth },
    { data: churnedThisMonth },
    { data: membershipGrowth },
    { data: paymentTrend },
  ] = await Promise.all([
    supabase.from('payments').select('amount').gte('created_at', monthStart),
    supabase.from('payments').select('amount').gte('created_at', lastMonthStart).lt('created_at', monthStart),
    supabase.from('attendance').select('id').gte('check_in', monthStart),
    supabase.from('attendance').select('id').gte('check_in', lastMonthStart).lt('check_in', monthStart),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).gte('created_at', lastMonthStart).lt('created_at', monthStart),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('status', 'active').lte('created_at', lastMonthEnd),
    supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('status', 'expired').gte('updated_at', monthStart),
    supabase.from('memberships').select('created_at, status').gte('created_at', new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0]),
    supabase.from('payments').select('amount, created_at').gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
  ]);

  const thisMonthRevenue = (thisMonthPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const lastMonthRevenue = (lastMonthPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const revenueGrowth = lastMonthRevenue > 0 ? Math.round((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100) : 0;

  const thisMonthVisits = (thisMonthAttendance || []).length;
  const lastMonthVisits = (lastMonthAttendance || []).length;
  const visitGrowth = lastMonthVisits > 0 ? Math.round((thisMonthVisits - lastMonthVisits) / lastMonthVisits * 100) : 0;

  const churnRate = (activeNow || 0) > 0 ? Math.round(((churnedThisMonth || 0) / (activeNow || 1)) * 100) : 0;

  // Monthly membership growth (last 6 months)
  const monthlyGrowth = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
    const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short' });
    const monthNext = i > 0 ? new Date(new Date().getFullYear(), new Date().getMonth() - i + 1, 1).toISOString().split('T')[0] : null;
    const monthKey = monthDate.toISOString().split('T')[0];

    const newMembers = (membershipGrowth || []).filter(m =>
      m.created_at >= monthKey && (monthNext ? m.created_at < monthNext : true)
    ).length;

    monthlyGrowth.push({ month: monthLabel, newMembers });
  }

  // Revenue trend (last 12 weeks)
  const revenueTrend = [];
  for (let i = 11; i >= 0; i--) {
    const weekStart = new Date(Date.now() - (i + 1) * 7 * 86400000).toISOString().split('T')[0];
    const weekEnd = new Date(Date.now() - i * 7 * 86400000).toISOString().split('T')[0];

    const weekRevenue = (paymentTrend || []).filter(p =>
      p.created_at >= weekStart && p.created_at < weekEnd
    ).reduce((s, p) => s + Number(p.amount), 0);

    revenueTrend.push({
      week: new Date(weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      amount: weekRevenue,
    });
  }

  // Cohort: new members retained after 30/60/90 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  const { data: cohort30 } = await supabase.from('memberships').select('member_id')
    .gte('created_at', new Date(Date.now() - 37 * 86400000).toISOString().split('T')[0])
    .lte('created_at', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);

  const { data: cohort60 } = await supabase.from('memberships').select('member_id')
    .gte('created_at', new Date(Date.now() - 67 * 86400000).toISOString().split('T')[0])
    .lte('created_at', new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]);

  const cohort30Ids = (cohort30 || []).map(c => c.member_id);
  const cohort60Ids = (cohort60 || []).map(c => c.member_id);

  let retention30 = 0, retention60 = 0;
  if (cohort30Ids.length > 0) {
    const { data: stillActive } = await supabase.from('memberships')
      .select('member_id').in('member_id', cohort30Ids).eq('status', 'active');
    retention30 = Math.round((stillActive?.length || 0) / cohort30Ids.length * 100);
  }
  if (cohort60Ids.length > 0) {
    const { data: stillActive } = await supabase.from('memberships')
      .select('member_id').in('member_id', cohort60Ids).eq('status', 'active');
    retention60 = Math.round((stillActive?.length || 0) / cohort60Ids.length * 100);
  }

  render(req, res, 'owner/bi', {
    title: 'Business Intelligence',
    stats: {
      thisMonthRevenue, lastMonthRevenue, revenueGrowth,
      thisMonthVisits, lastMonthVisits, visitGrowth,
      thisMonthNew: thisMonthNew || 0, lastMonthNew: lastMonthNew || 0,
      activeNow: activeNow || 0, activeLastMonth: activeLastMonth || 0,
      churnRate, churnedThisMonth: churnedThisMonth || 0,
    },
    monthlyGrowth,
    revenueTrend,
    retention: { day30: retention30, day60: retention60 },
    maxRevenue: Math.max(...revenueTrend.map(r => r.amount), 1),
  });
});

module.exports = router;
