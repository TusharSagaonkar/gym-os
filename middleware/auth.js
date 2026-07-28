const jwt = require('jsonwebtoken');
const { supabase } = require('../lib/supabase');

async function authMiddleware(req, res, next) {
  const token = req.cookies?.sb_token;

  if (!token) {
    res.locals.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.locals.user = {
      id: decoded.user_id,
      email: decoded.email,
      full_name: decoded.full_name || 'User',
      role: decoded.role || 'member',
    };
    next();
  } catch {
    res.locals.user = null;
    next();
  }
}

function requireAuth(req, res, next) {
  if (!res.locals.user) {
    return res.redirect('/auth/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!res.locals.user) {
      return res.redirect('/auth/login');
    }
    if (!roles.includes(res.locals.user.role)) {
      return res.status(403).render('shared/error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this page.',
        user: res.locals.user,
      });
    }
    next();
  };
}

async function gymMiddleware(req, res, next) {
  if (!res.locals.user) return next();

  try {
    const activeGymId = req.cookies?.active_gym;

    if (activeGymId) {
      const { data: gym } = await supabase.from('gyms').select('*').eq('id', activeGymId).single();
      if (gym) {
        res.locals.gym = gym;
        res.locals.gymId = gym.id;
        return next();
      }
    }

    const { data: gyms } = await supabase.from('gyms').select('*').limit(1);
    if (gyms?.length > 0) {
      res.locals.gym = gyms[0];
      res.locals.gymId = gyms[0].id;
    }
  } catch {
    // gym lookup failed silently, not critical
  }

  next();
}

module.exports = { authMiddleware, gymMiddleware, requireAuth, requireRole };
