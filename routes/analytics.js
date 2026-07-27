const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('owner', 'reception'));

function render(req, res, view, data = {}) {
  const ctx = { ...data, user: res.locals.user, gym: res.locals.gym, title: data.title || 'Analytics' };
  if (req.headers['hx-request']) return res.render(view, ctx);
  res.render('layout', { ...ctx, body: view, bodyData: ctx });
}

// ── Occupancy Analytics ────────────────────────────────────
router.get('/occupancy', async (req, res) => {
  const gymId = res.locals.gymId;
  const days = parseInt(req.query.days) || 7;

  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  let query = supabase.from('attendance')
    .select('check_in, check_out, duration_minutes')
    .gte('check_in', startDate + 'T00:00:00')
    .order('check_in', { ascending: true });

  if (gymId) query = query.eq('gym_id', gymId);

  const { data: records } = await query.limit(5000);

  // Build heatmap: dayOfWeek[0-6] × hour[5-23]
  const heatmap = {};
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let d = 0; d < 7; d++) {
    heatmap[d] = {};
    for (let h = 5; h <= 23; h++) heatmap[d][h] = 0;
  }

  let totalDuration = 0;
  let completedVisits = 0;

  (records || []).forEach(r => {
    const dt = new Date(r.check_in);
    const day = dt.getDay();
    const hour = dt.getHours();
    if (hour >= 5 && hour <= 23) heatmap[day][hour]++;

    if (r.duration_minutes) {
      totalDuration += r.duration_minutes;
      completedVisits++;
    }
  });

  // Find max for coloring
  let maxCount = 0;
  for (let d = 0; d < 7; d++) for (let h = 5; h <= 23; h++) if (heatmap[d][h] > maxCount) maxCount = heatmap[d][h];

  // Busiest day + hour
  let busiestDay = 0, busiestHour = 0, busiestCount = 0;
  for (let d = 0; d < 7; d++) for (let h = 5; h <= 23; h++) if (heatmap[d][h] > busiestCount) { busiestCount = heatmap[d][h]; busiestDay = d; busiestHour = h; }

  // Quietest period (find 3-consecutive-hour minimum average)
  let quietestStart = 5, quietestAvg = Infinity;
  for (let h = 5; h <= 21; h++) {
    const avg = (heatmap[1][h] + heatmap[1][h+1] + heatmap[1][h+2] + heatmap[2][h] + heatmap[2][h+1] + heatmap[2][h+2] + heatmap[3][h] + heatmap[3][h+1] + heatmap[3][h+2] + heatmap[4][h] + heatmap[4][h+1] + heatmap[4][h+2]) / 15;
    if (avg < quietestAvg) { quietestAvg = avg; quietestStart = h; }
  }

  // Daily totals
  const dailyTotals = {};
  for (let d = 0; d < 7; d++) {
    dailyTotals[d] = Object.values(heatmap[d]).reduce((a, b) => a + b, 0);
  }

  const avgDuration = completedVisits > 0 ? Math.round(totalDuration / completedVisits) : 0;

  render(req, res, 'owner/analytics', {
    title: 'Occupancy Analytics',
    heatmap, dayLabels, maxCount, days,
    busiestDay, busiestHour, busiestCount,
    quietestStart, quietestAvg: Math.round(quietestAvg),
    dailyTotals, avgDuration, totalRecords: (records || []).length,
  });
});

// ── Generate analytics snapshot (called via cron or manual) ─
router.post('/snapshot', async (req, res) => {
  const gymId = res.locals.gymId;
  const date = new Date().toISOString().split('T')[0];

  const { data: checkins } = await supabase.from('attendance')
    .select('*').gte('check_in', date + 'T00:00:00').lte('check_in', date + 'T23:59:59');

  const { data: payments } = await supabase.from('payments')
    .select('amount, payment_type').gte('created_at', date + 'T00:00:00');

  const { count: newMembers } = await supabase.from('memberships')
    .select('*', { count: 'exact', head: true }).gte('created_at', date + 'T00:00:00');

  const { count: renewals } = await supabase.from('payments')
    .select('*', { count: 'exact', head: true }).eq('payment_type', 'renewal').gte('created_at', date + 'T00:00:00');

  const { count: active } = await supabase.from('memberships')
    .select('*', { count: 'exact', head: true }).eq('status', 'active');

  const hours = {};
  (checkins || []).forEach(c => { const h = new Date(c.check_in).getHours(); hours[h] = (hours[h] || 0) + 1; });
  let peakHour = null, peakCount = 0;
  for (const [h, c] of Object.entries(hours)) { if (c > peakCount) { peakCount = c; peakHour = parseInt(h); } }

  const uniqueMembers = new Set((checkins || []).map(c => c.member_id)).size;
  const completed = (checkins || []).filter(c => c.duration_minutes);
  const avgDuration = completed.length > 0 ? completed.reduce((s, c) => s + c.duration_minutes, 0) / completed.length : 0;
  const revenue = (payments || []).reduce((s, p) => s + Number(p.amount), 0);

  await supabase.from('analytics_snapshots').upsert({
    gym_id: gymId, snapshot_date: date,
    total_checkins: (checkins || []).length, unique_members: uniqueMembers,
    peak_hour: peakHour, peak_count: peakCount,
    avg_duration_minutes: avgDuration, total_revenue: revenue,
    new_members: newMembers || 0, renewals: renewals || 0,
    active_members: active || 0,
    capacity_pct: gymId ? Math.round(((checkins || []).length / 100) * 100) : null,
  }, { onConflict: 'gym_id,snapshot_date' });

  res.json({ ok: true, snapshots: 1 });
});

// ── Churn Dashboard ────────────────────────────────────────
router.get('/churn', async (req, res) => {
  const gymId = res.locals.gymId;
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  // Active members
  const { data: activeMembers } = await supabase.from('memberships')
    .select('member_id, end_date, profiles!inner(full_name, phone)')
    .eq('status', 'active');

  const memberIds = (activeMembers || []).map(m => m.member_id);
  if (memberIds.length === 0) {
    return render(req, res, 'owner/churn', { title: 'Churn Analysis', atRisk: [], expiring: [], disengaging: [], stats: { atRiskCount: 0, expiringCount: 0, disengagingCount: 0 } });
  }

  // Get recent attendance
  const { data: recentAttendance } = await supabase.from('attendance')
    .select('member_id, check_in')
    .in('member_id', memberIds)
    .gte('check_in', twoWeeksAgo + 'T00:00:00')
    .order('check_in', { ascending: false });

  const { data: olderAttendance } = await supabase.from('attendance')
    .select('member_id, check_in')
    .in('member_id', memberIds)
    .gte('check_in', new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0] + 'T00:00:00')
    .lt('check_in', twoWeeksAgo + 'T00:00:00');

  const atRisk = [];
  const expiring = [];
  const disengaging = [];

  const memberMap = {};
  (activeMembers || []).forEach(m => { memberMap[m.member_id] = m; });

  const visitedRecently = new Set();
  const visitCounts = {};
  (recentAttendance || []).forEach(a => {
    visitedRecently.add(a.member_id);
    visitCounts[a.member_id] = (visitCounts[a.member_id] || 0) + 1;
  });

  const oldVisitCounts = {};
  (olderAttendance || []).forEach(a => {
    oldVisitCounts[a.member_id] = (oldVisitCounts[a.member_id] || 0) + 1;
  });

  for (const [memberId, member] of Object.entries(memberMap)) {
    const daysToExpiry = Math.ceil((new Date(member.end_date) - new Date()) / 86400000);

    // Expiring soon
    if (daysToExpiry <= 7 && daysToExpiry > 0) {
      expiring.push({ ...member, daysLeft: daysToExpiry, lastVisit: visitedRecently.has(memberId) ? 'Recent' : 'None' });
    }

    // At risk: no visit in 7+ days
    if (!visitedRecently.has(memberId) || (visitCounts[memberId] || 0) === 0) {
      const lastVisit = recentAttendance?.find(a => a.member_id === memberId);
      atRisk.push({ ...member, daysInactive: lastVisit ? Math.ceil((new Date() - new Date(lastVisit.check_in)) / 86400000) : 14 });
    }

    // Disengaging: declining attendance
    const recent = visitCounts[memberId] || 0;
    const older = oldVisitCounts[memberId] || 0;
    if (older > 0 && recent < older * 0.5 && visitedRecently.has(memberId)) {
      disengaging.push({ ...member, recentVisits: recent, olderVisits: older, decline: Math.round((1 - recent / older) * 100) });
    }
  }

  // Deduplicate
  const atRiskIds = new Set(atRisk.map(m => m.member_id));
  const filteredDisengaging = disengaging.filter(m => !atRiskIds.has(m.member_id));

  render(req, res, 'owner/churn', {
    title: 'Churn Analysis',
    atRisk: atRisk.slice(0, 20),
    expiring: expiring.slice(0, 20),
    disengaging: filteredDisengaging.slice(0, 20),
    stats: {
      atRiskCount: atRisk.length,
      expiringCount: expiring.length,
      disengagingCount: filteredDisengaging.length,
      totalActive: memberIds.length,
    },
  });
});

// ── Smart Recommendations ──────────────────────────────────
router.get('/recommendations', async (req, res) => {
  const { data: activeMembers } = await supabase.from('memberships')
    .select('member_id, plan_id, profiles!inner(full_name, phone)')
    .eq('status', 'active');

  const { data: plans } = await supabase.from('membership_plans').select('*').eq('is_active', true).order('price');

  const memberIds = (activeMembers || []).map(m => m.member_id);
  const { data: attendance } = memberIds.length > 0
    ? await supabase.from('attendance')
        .select('member_id, check_in')
        .in('member_id', memberIds)
        .gte('check_in', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] + 'T00:00:00')
    : { data: [] };

  const recs = [];
  const planMap = {};
  (plans || []).forEach(p => { planMap[p.id] = p; });

  (activeMembers || []).forEach(m => {
    const visits = (attendance || []).filter(a => a.member_id === m.member_id).length;
    const currentPlan = planMap[m.plan_id];
    if (!currentPlan) return;

    const monthlyVisits = Math.round(visits);
    const costPerVisit = currentPlan.price / Math.max(1, monthlyVisits);

    // If visiting 20+ times/month on a monthly plan, suggest annual
    if (monthlyVisits >= 20 && currentPlan.duration_months <= 1) {
      const annual = plans?.find(p => p.duration_months >= 12);
      if (annual && annual.price < currentPlan.price * 12) {
        recs.push({
          memberName: m.profiles?.full_name,
          memberPhone: m.profiles?.phone,
          currentPlan: currentPlan.name,
          suggestedPlan: annual.name,
          reason: `Visiting ${monthlyVisits}x/month. Switching saves ₹${((currentPlan.price * 12) - annual.price).toLocaleString()}/year.`,
          savings: (currentPlan.price * 12) - annual.price,
        });
      }
    }

    // If visiting < 4 times/month, suggest day pass or quarterly
    if (monthlyVisits <= 4 && monthlyVisits > 0 && currentPlan.duration_months <= 1) {
      const dayPass = plans?.find(p => p.duration_months === 0);
      if (dayPass && dayPass.price * monthlyVisits < currentPlan.price) {
        recs.push({
          memberName: m.profiles?.full_name,
          memberPhone: m.profiles?.phone,
          currentPlan: currentPlan.name,
          suggestedPlan: `Day Pass (${monthlyVisits}x)`,
          reason: `Only visiting ${monthlyVisits}x/month. Pay-per-visit saves ₹${(currentPlan.price - dayPass.price * monthlyVisits).toLocaleString()}/month.`,
          savings: currentPlan.price - dayPass.price * monthlyVisits,
        });
      }
    }
  });

  // Sort by savings
  recs.sort((a, b) => b.savings - a.savings);

  render(req, res, 'owner/recommendations', {
    title: 'Smart Recommendations',
    recs: recs.slice(0, 30),
    totalRecs: recs.length,
  });
});

// ── Generate member insights ───────────────────────────────
router.post('/generate-insights', async (req, res) => {
  const { data: activeMembers } = await supabase.from('memberships')
    .select('member_id').eq('status', 'active');

  const memberIds = (activeMembers || []).map(m => m.member_id);
  if (memberIds.length === 0) return res.json({ ok: true, members: 0 });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const { data: allAttendance } = await supabase.from('attendance')
    .select('member_id, check_in, duration_minutes')
    .in('member_id', memberIds)
    .gte('check_in', thirtyDaysAgo + 'T00:00:00')
    .order('check_in', { ascending: false });

  const { data: plans } = await supabase.from('membership_plans').select('*').eq('is_active', true);

  for (const memberId of memberIds) {
    const memberAttendance = (allAttendance || []).filter(a => a.member_id === memberId);
    const recentAttendance = memberAttendance.filter(a => a.check_in >= sevenDaysAgo + 'T00:00:00');
    const olderAttendance = memberAttendance.filter(a => a.check_in < sevenDaysAgo + 'T00:00:00');

    const lastVisit = memberAttendance[0]?.check_in || null;
    const daysSinceLast = lastVisit ? Math.ceil((new Date() - new Date(lastVisit)) / 86400000) : 30;

    const avgVisitsPerWeek = (memberAttendance.length / 4.3).toFixed(1);
    const completed = memberAttendance.filter(a => a.duration_minutes);
    const avgDuration = completed.length > 0 ? completed.reduce((s, a) => s + a.duration_minutes, 0) / completed.length : 0;

    let churnRisk = 'low';
    const factors = [];

    if (daysSinceLast > 14) { churnRisk = 'high'; factors.push('No visit in 14+ days'); }
    else if (daysSinceLast > 7) { churnRisk = 'medium'; factors.push('No visit in 7+ days'); }

    if (memberAttendance.length < 4) { factors.push('Low attendance frequency'); if (churnRisk === 'low') churnRisk = 'medium'; }

    let visitTrend = 'stable';
    if (recentAttendance.length === 0 && olderAttendance.length > 0) visitTrend = 'inactive';
    else if (recentAttendance.length < olderAttendance.length * 0.5) visitTrend = 'declining';
    else if (recentAttendance.length > olderAttendance.length * 1.5) visitTrend = 'rising';

    if (visitTrend === 'declining') { factors.push('Declining attendance trend'); if (churnRisk === 'low') churnRisk = 'medium'; }
    if (visitTrend === 'inactive' && churnRisk === 'low') churnRisk = 'high';

    // Find best plan suggestion
    const monthlyVisits = Math.round(memberAttendance.length);
    let suggestedPlanId = null, suggestionReason = null;
    const currentMembership = (activeMembers || []).find(m => m.member_id === memberId);

    if (monthlyVisits >= 20) {
      const annual = plans?.find(p => p.duration_months >= 12);
      if (annual) { suggestedPlanId = annual.id; suggestionReason = `High frequency (${monthlyVisits}x/mo). Annual plan saves money.`; }
    } else if (monthlyVisits <= 4 && monthlyVisits > 0) {
      const dayPass = plans?.find(p => p.duration_months === 0);
      if (dayPass) { suggestedPlanId = dayPass.id; suggestionReason = `Low frequency (${monthlyVisits}x/mo). Day pass may be cheaper.`; }
    }

    await supabase.from('member_insights').upsert({
      member_id: memberId,
      churn_risk: churnRisk,
      churn_factors: factors,
      last_visit: lastVisit ? new Date(lastVisit).toISOString().split('T')[0] : null,
      visit_streak_days: 0,
      avg_visits_per_week: parseFloat(avgVisitsPerWeek),
      avg_duration_minutes: parseFloat(avgDuration.toFixed(1)),
      visit_trend: visitTrend,
      suggested_plan_id: suggestedPlanId,
      suggestion_reason: suggestionReason,
      days_since_last_visit: daysSinceLast,
    }, { onConflict: 'member_id' });
  }

  res.json({ ok: true, members: memberIds.length });
});

// ── Marketing Automation ───────────────────────────────────
router.get('/marketing', async (req, res) => {
  const gymId = res.locals.gymId;
  const { data: rules } = await supabase.from('automation_rules')
    .select('*').order('created_at', { ascending: false });

  render(req, res, 'owner/marketing', {
    title: 'Marketing Automation',
    rules: rules || [],
  });
});

router.post('/marketing/rule', async (req, res) => {
  const { name, description, trigger_type, action_type, action_template } = req.body;
  await supabase.from('automation_rules').insert({
    name, description, trigger_type, action_type, action_template,
    gym_id: res.locals.gymId,
  });
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

router.post('/marketing/rule/:id/toggle', async (req, res) => {
  const { data: rule } = await supabase.from('automation_rules').select('is_active').eq('id', req.params.id).single();
  if (rule) {
    await supabase.from('automation_rules').update({ is_active: !rule.is_active }).eq('id', req.params.id);
  }
  res.setHeader('HX-Refresh', 'true');
  res.send('');
});

router.post('/marketing/trigger/:ruleId', async (req, res) => {
  const { data: rule } = await supabase.from('automation_rules').select('*').eq('id', req.params.ruleId).single();
  if (!rule) return res.json({ ok: false, error: 'Rule not found' });

  let targetMembers = [];

  if (rule.trigger_type === 'membership_expiring') {
    const { data } = await supabase.from('memberships')
      .select('member_id, profiles(full_name)')
      .eq('status', 'active')
      .lte('end_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0])
      .gte('end_date', new Date().toISOString().split('T')[0]);
    targetMembers = data || [];
  } else if (rule.trigger_type === 'inactive_7_days') {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: active } = await supabase.from('memberships').select('member_id').eq('status', 'active');
    const ids = (active || []).map(m => m.member_id);
    if (ids.length > 0) {
      const { data: recent } = await supabase.from('attendance').select('member_id').in('member_id', ids).gte('check_in', weekAgo);
      const recentIds = new Set((recent || []).map(r => r.member_id));
      const inactiveIds = ids.filter(id => !recentIds.has(id));
      if (inactiveIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', inactiveIds.slice(0, 50));
        targetMembers = (profiles || []).map(p => ({ member_id: p.id, profiles: p }));
      }
    }
  } else if (rule.trigger_type === 'first_visit') {
    const { data } = await supabase.from('attendance').select('member_id, profiles(full_name)')
      .gte('check_in', new Date().toISOString().split('T')[0] + 'T00:00:00');
    targetMembers = data || [];
  }

  let sent = 0;
  for (const m of targetMembers) {
    await supabase.from('notifications').insert({
      user_id: m.member_id,
      title: rule.name,
      message: rule.action_template,
      type: 'general',
    });
    sent++;
  }

  res.json({ ok: true, sent, rule: rule.name });
});

module.exports = router;
