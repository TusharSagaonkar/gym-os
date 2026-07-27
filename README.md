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

### Vercel

1. Import repo at [vercel.com/import](https://vercel.com/import)
2. Set environment variables (same as `.env.example`)
3. Deploy — `vercel.json` handles Express routing

### Render

1. Connect repo at [render.com](https://render.com) → New Web Service
2. Set environment variables from `.env.example`
3. Uses `render.yaml` auto-detection or `npm start`

### Environment Variables Required

| Variable | Description |
|----------|------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` key (server-side operations) |
| `SUPABASE_ANON_KEY` | Supabase `anon` public key |
| `JWT_SECRET` | Random string for signing auth cookies |
| `BASE_URL` | Your deployed app URL |
| `NODE_ENV` | `production` (skips dotenv in production) |

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
