const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAuth, requireRole } = require('../middleware/auth');
const { supabase } = require('../lib/supabase');

const router = express.Router();

router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/');
  res.render('auth/login', { title: 'Login', user: null, error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return res.render('auth/login', {
      title: 'Login',
      user: null,
      error: 'Invalid email or password.',
    });
  }

  const token = jwt.sign(
    { user_id: data.user.id, email: data.user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );

  res.cookie('sb_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  if (!profile) return res.redirect('/auth/onboarding');

  switch (profile.role) {
    case 'owner': return res.redirect('/owner');
    case 'reception': return res.redirect('/reception');
    case 'trainer': return res.redirect('/trainer');
    case 'member': return res.redirect('/member');
    default: return res.redirect('/');
  }
});

router.get('/signup', (req, res) => {
  res.render('auth/signup', { title: 'Join Gym', user: null, error: null });
});

router.post('/signup', async (req, res) => {
  const { email, password, full_name, phone } = req.body;

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return res.render('auth/signup', {
      title: 'Join Gym',
      user: null,
      error: error.message,
    });
  }

  if (data.user) {
    await supabase.from('profiles').insert({
      id: data.user.id,
      full_name,
      phone,
      role: 'member',
    });
  }

  res.redirect('/auth/login?registered=true');
});

router.get('/onboarding', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', res.locals.user.id)
    .single();

  if (profile) return res.redirect('/');

  res.render('auth/onboarding', {
    title: 'Complete Setup',
    user: { id: res.locals.user.id },
    error: null,
  });
});

router.post('/onboarding', requireAuth, async (req, res) => {
  const { full_name, phone, role } = req.body;

  await supabase.from('profiles').insert({
    id: res.locals.user.id,
    full_name,
    phone,
    role: role || 'member',
  });

  res.redirect('/');
});

router.get('/logout', (req, res) => {
  res.clearCookie('sb_token');
  res.redirect('/auth/login');
});

module.exports = router;
