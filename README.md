# 🏋️ GYM OS

**Fast, intelligent gym operating system that saves time for owners and never gets in the member's way.**

Built with Express.js, HTMX, Tailwind CSS, and Supabase. Server-rendered HTML with partial-page updates — no heavy SPA framework. Members scan a QR code, work out, and leave. Owners run the business from a single dashboard.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Express.js (Node.js) |
| Templates | EJS |
| Interactivity | HTMX (no SPA) |
| Styling | Tailwind CSS (CDN) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth + JWT cookies |
| QR Codes | node-qrcode |
| Deploy | Render / Vercel |

---

## Features by Phase

### Phase 1 — MVP (Core Gym Operations)

| Role | Features |
|------|----------|
| **Owner** | Live dashboard (members inside, trainers, capacity %, peak hour), member CRUD with renew/freeze/transfer, payment tracking, attendance logs, trainer list, reports (daily/weekly/monthly), membership plan management |
| **Reception** | Search member → renew → collect payment → print receipt (3-click workflow), new admission form with plan + payment, QR/manual check-in/check-out |
| **Trainer** | Dashboard with member count + sessions, member list with progress recording, workout template builder (dynamic exercises), session scheduler, progress overview |
| **Member** | Home screen (greeting, membership status, today's workout, assigned trainer, gym busy level), QR check-in button, workout view (no forced logging), body progress chart, payment history, trainer bookings, notifications |

### Phase 2 — Classes & Multi-Branch

- **Group Classes**: Create class types (Yoga, HIIT, Strength, etc.), schedule sessions with trainer + capacity, member browsing with category filters, one-click booking with HTMX, cancellation, full/waitlist indicators
- **Multi-Branch Support**: Create/manage multiple gym branches, switch between branches via cookie, branch-specific capacity, hours, and data filtering

### Phase 3 — Analytics & AI Insights

- **Occupancy Analytics**: Color-coded hourly heatmap (7 days × 5am–11pm), daily bar chart, busiest/quietest period detection
- **Churn Prediction**: 3 risk categories (at-risk 7d+ inactive, expiring ≤7 days, disengaging with declining attendance), rule-based scoring
- **Smart Recommendations**: Plan-switch suggestions based on 30-day visit patterns with ₹ savings calculation
- **Marketing Automation**: Configurable trigger→action rules (membership expiring, inactive 7 days, first visit), one-click "Run Now" to send notifications, toggle on/off per rule

### Phase 4 — Integrations & Advanced BI

- **IoT Sensors**: Register occupancy/temperature/noise sensors, per-device API keys, real-time reading ingestion, sensor dashboard
- **Smart Gates**: Gate/turnstile device registration, webhook endpoint (`POST /integrations/gate/event`), auto check-in/check-out with membership validation
- **Face Recognition**: Face photo enrollment, verification workflow, API endpoint for camera integration
- **Wearable Data**: Steps, heart rate, calories, active minutes ingestion per member, displayed in member progress view with 7-day history
- **Business Intelligence**: MoM revenue/visits growth, 12-week revenue trend, 6-month membership growth chart, cohort retention (30/60-day), churn rate, revenue-per-member metrics

---

## Quick Start

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project

### 1. Clone & Install

```bash
git clone https://github.com/TusharSagaonkar/gym-os.git
cd gym-os
npm install
```

### 2. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run the entire `database/schema.sql`
3. Go to **Settings → API** → copy the project URL, `service_role` key, and `anon` public key

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_your_service_role_key
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=generate-a-random-64-character-string
PORT=3000
BASE_URL=http://localhost:3000
```

### 4. Run

```bash
npm run dev
```

Open **http://localhost:3000** → sign up → choose a role during onboarding.

---

## Project Structure

```
gym-os/
├── api/
│   └── index.js          # Vercel serverless entry point
├── database/
│   └── schema.sql        # 25 tables, RLS policies, seed data
├── lib/
│   └── supabase.js       # Supabase client config
├── middleware/
│   └── auth.js           # JWT auth + role guards + gym resolver
├── routes/
│   ├── auth.js           # Login, signup, onboarding
│   ├── owner.js          # Dashboard, members, payments, attendance, trainers, plans, gyms, classes
│   ├── reception.js      # Member search, new admission, QR check-in
│   ├── trainer.js        # Members, workouts, schedule, progress, classes
│   ├── member.js         # Home, QR, workout, progress, membership, bookings
│   ├── classes.js        # Class browsing, booking, cancellation
│   ├── analytics.js      # Occupancy, churn, recommendations, marketing
│   └── integrations.js   # Gates, sensors, wearables, faces, business intelligence
├── views/
│   ├── layout.ejs        # Main layout with sidebar + header
│   ├── partials/         # Sidebar, header, nav menus (4 roles)
│   ├── auth/             # Login, signup, onboarding
│   ├── owner/            # 16 screens (dashboard, members, payments, analytics, etc.)
│   ├── reception/        # 4 screens (search, members, new admission, attendance)
│   ├── trainer/          # 6 screens (dashboard, members, workouts, schedule, etc.)
│   ├── member/           # 8 screens (home, QR, workout, progress, etc.)
│   └── shared/           # Error, classes, my-classes
├── app.js                # Express app (exported for Vercel + local dev)
├── server.js             # Local dev server entry point
├── vercel.json           # Vercel deployment config
├── render.yaml           # Render Blueprint config
└── package.json
```

---

## Deployment

### Prerequisite: Supabase Setup (required for all options)

Before deploying the app, you need a running Supabase project:

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose a name, set a database password, pick the region closest to your users
3. Wait for the project to provision (~2 minutes)
4. Go to **SQL Editor** → paste the entire contents of `database/schema.sql` → click **Run**
5. Go to **Settings → API** → copy these 3 values:
   - **Project URL** (`https://xxx.supabase.co`)
   - **`service_role` key** (starts with `sb_secret_...` — keep this private)
   - **`anon` public key** (starts with `eyJhbG...`)

---

### Option 1: Vercel (Free, easiest)

Vercel is serverless — no server to manage. Cold starts are ~500ms. Free tier includes 100GB bandwidth/month.

1. Go to [vercel.com](https://vercel.com) → **Log In** with GitHub
2. Click **Add New → Project**
3. Select `TusharSagaonkar/gym-os` (or your fork)
4. Vercel auto-detects the framework — leave defaults
5. Expand **Environment Variables** and add:

   | Key | Value |
   |-----|-------|
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Your `service_role` key |
   | `SUPABASE_ANON_KEY` | Your `anon` public key |
   | `JWT_SECRET` | Generate one: `openssl rand -hex 32` |
   | `BASE_URL` | `https://gym-os.vercel.app` (or your custom domain) |
   | `NODE_ENV` | `production` |

6. Click **Deploy**
7. Your app is live at `https://gym-os.vercel.app`

**How it works**: `vercel.json` rewrites all requests to `api/index.js`, which is a serverless function wrapping the Express app. Each request spins up a cold instance if needed — first request may take 1–2 seconds, subsequent requests are fast.

**Note for Vercel**: Since Vercel functions have a 10-second timeout limit, heavy analytics queries should be fast enough at this scale. For a gym with 500+ members doing analytics, consider Render or VPS.

---

### Option 2: Render (Free, full server)

Render gives you a persistent Node.js server. No cold starts. Free tier includes 750 hours/month.

1. Go to [render.com](https://render.com) → **Log In** with GitHub
2. Click **New → Web Service**
3. Connect your GitHub repo `TusharSagaonkar/gym-os`
4. Configure:
   - **Name**: `gym-os`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

5. Scroll to **Environment Variables** and add:

   | Key | Value |
   |-----|-------|
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Your `service_role` key |
   | `SUPABASE_ANON_KEY` | Your `anon` public key |
   | `JWT_SECRET` | Generate one: `openssl rand -hex 32` |
   | `BASE_URL` | `https://gym-os.onrender.com` |
   | `NODE_ENV` | `production` |

6. Click **Create Web Service** — deploys in ~3 minutes
7. Your app is live at `https://gym-os.onrender.com`

**Note**: Free Render services spin down after 15 minutes of inactivity. First request after idle takes ~30 seconds to wake up. Use a free uptime monitor like [uptimerobot.com](https://uptimerobot.com) to ping your `/health` endpoint every 5 minutes to keep it alive.

---

### Option 3: VPS (Ubuntu/Debian)

Full control. Any VPS provider works: DigitalOcean, Linode, Hetzner, AWS EC2, etc.

#### Step 1: Set up the server

```bash
# SSH into your VPS
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# Verify
node -v   # Should show v20.x.x
npm -v    # Should show 10.x.x
```

#### Step 2: Clone and install

```bash
# Create app directory
mkdir -p /opt/gym-os
cd /opt/gym-os

# Clone the repo
git clone https://github.com/TusharSagaonkar/gym-os.git .

# Install dependencies
npm install --production
```

#### Step 3: Configure environment

```bash
# Create .env file
cat > .env << 'EOF'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_your_service_role_key
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=$(openssl rand -hex 32)
BASE_URL=https://your-domain.com
PORT=3000
NODE_ENV=production
EOF

# Actually set the JWT_SECRET properly
JWT_SECRET=$(openssl rand -hex 32)
sed -i "s/JWT_SECRET=\$(openssl rand -hex 32)/JWT_SECRET=$JWT_SECRET/" .env
```

#### Step 4: Set up PM2 (process manager)

```bash
# Install PM2 globally
npm install -g pm2

# Start the app
pm2 start server.js --name gym-os

# Auto-start on reboot
pm2 startup systemd
pm2 save

# Verify it's running
pm2 status
curl http://localhost:3000/health
```

#### Step 5: Set up Nginx (reverse proxy + HTTPS)

```bash
# Install Nginx
apt install -y nginx

# Create site config
cat > /etc/nginx/sites-available/gym-os << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable the site
ln -s /etc/nginx/sites-available/gym-os /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

#### Step 6: SSL with Let's Encrypt

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
# Verify: certbot renew --dry-run
```

#### Step 7: Firewall

```bash
# Allow only HTTP, HTTPS, and SSH
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

#### Updating the app later

```bash
cd /opt/gym-os
git pull
npm install --production
pm2 restart gym-os
```

---

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|------------|
| `SUPABASE_URL` | Yes | Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase `service_role` key (server-side DB operations) |
| `SUPABASE_ANON_KEY` | Yes | Supabase `anon` public key (client-side auth) |
| `JWT_SECRET` | Yes | Random string for signing auth cookies. Generate: `openssl rand -hex 32` |
| `BASE_URL` | Yes | Your app's public URL (used for redirects and QR codes) |
| `PORT` | No | Server port (default `3000`, Vercel sets this automatically) |
| `NODE_ENV` | No | Set to `production` to skip dotenv loading |

---

## Architecture Notes

### HTMX Patterns

- **Dashboard**: Auto-refreshes every 30s (`hx-trigger="every 30s"`)
- **Search**: Debounced at 300ms (`hx-trigger="keyup changed delay:300ms"`)
- **Forms**: Modals use `HX-Refresh`/`HX-Redirect` headers on success
- **Bookings**: Inline status updates via `hx-target` + `hx-swap`
- **Check-in**: POST swaps the result div without page reload

### Auth Flow

1. User logs in via Supabase Auth → receives JWT stored in httpOnly cookie
2. `authMiddleware` decodes JWT, fetches profile from `profiles` table
3. `requireRole()` middleware restricts routes by role
4. `gymMiddleware` resolves active branch from cookie (for multi-branch)

### Database

25 PostgreSQL tables with Row Level Security. All tables have RLS policies scoped by role:
- **Members** can only read their own data
- **Trainers** can read assigned members
- **Staff** (owner/reception) have full read access
- **Insert** operations restricted to appropriate roles

---

## License

MIT
