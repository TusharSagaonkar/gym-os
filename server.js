if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { authMiddleware, gymMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);
app.use(gymMiddleware);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.get('/', (req, res) => {
  if (!res.locals.user) return res.redirect('/auth/login');
  switch (res.locals.user.role) {
    case 'owner': return res.redirect('/owner');
    case 'reception': return res.redirect('/reception');
    case 'trainer': return res.redirect('/trainer');
    case 'member': return res.redirect('/member');
    default: return res.redirect('/auth/login');
  }
});

app.use('/auth', require('./routes/auth'));
app.use('/owner', require('./routes/owner'));
app.use('/reception', require('./routes/reception'));
app.use('/trainer', require('./routes/trainer'));
app.use('/member', require('./routes/member'));
app.use('/classes', require('./routes/classes'));
app.use('/analytics', require('./routes/analytics'));
app.use('/integrations', require('./routes/integrations'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => {
  res.status(404).render('shared/error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    user: res.locals.user,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GYM OS running on port ${PORT}`);
});
