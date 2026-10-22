# SkipTheQueue — Smart Queue Management & Appointment Scheduling

A full-stack web application built from the SkipTheQueue SRS concept. It includes citizen appointment booking and queue tracking, branch-aware staff operations, persistent queue state, explainable service-time/wait predictions, priority-aware ordering, audit logs, complaint handling, admin forecasting, notifications, feedback and CSV reports.

## Technology
- Node.js + Express REST API
- SQLite database using Node.js built-in `node:sqlite` (no `better-sqlite3` native addon or Visual Studio C++ build tools required)
- JWT authentication and bcrypt password hashing
- Responsive HTML/CSS/JavaScript frontend (no frontend build step)
- CSV reporting

## Requirements
- Node.js 22.5 or newer (your Node.js v24.14.0 is compatible)
- npm

## Run locally (Windows, macOS or Linux)
1. Extract `SkipTheQueue_Project.zip`.
2. Open a terminal in the extracted `SkipTheQueue_Project` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and replace `JWT_SECRET` with a long random secret. The app has a development-only fallback if you skip this, so set the secret before using real data.
5. Start the app:
   ```bash
   npm start
   ```
6. Open **http://localhost:3000**.

The SQLite database is created automatically at `data/skipthequeue.db`. This version uses Node’s built-in SQLite module, so installation does not need to compile `better-sqlite3`. Node may display an experimental warning for `node:sqlite`; this is expected on some Node versions. Seed demo records are added only when the database has no users. Delete the database file (while the server is stopped) to reset the demo data.

## Demo accounts
All three seeded demo accounts use password `Queue@123`.

| Role | Email | Capabilities |
|---|---|---|
| Citizen | `citizen@skipthequeue.demo` | Book, reschedule and cancel own appointments; view tokens and notifications; submit feedback and support tickets |
| Staff | `staff@skipthequeue.demo` | Review appointments, check in tokens, manage queue status, view dashboard, feedback and branch complaints, export CSV |
| Admin | `admin@skipthequeue.demo` | System dashboard, branch/counter/service management APIs, staff account and branch assignment APIs, demand forecast, audit log, settings, CSV export |

## Core workflows to try
1. Sign in as Citizen. Create an appointment for today or a future date and see the generated token.
2. Open **My appointments** to reschedule or cancel a booked/waiting appointment.
3. Sign in as Staff and open **Queue management** to check in a token, start service, complete service or mark no-show.
4. Submit feedback and a support ticket as Citizen; view/update them as Staff.
5. Sign in as Admin and add a service branch or review registered users.
6. Download the CSV report from a Staff/Admin view.

## API overview
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/me`
- `GET /api/branches`
- `GET/POST /api/appointments`, `PATCH /api/appointments/:id`
- `GET /api/queue`, `POST /api/queue/check-in`, `POST /api/queue/next`, `PATCH /api/queue/:id/status`, `GET /api/dashboard`
- `GET /api/predictions/:appointmentId`
- `GET /api/admin/forecast`, `GET /api/admin/audit`, `GET/PATCH /api/admin/settings`
- `GET/POST /api/admin/counters`, `GET/POST /api/admin/services`, `POST /api/admin/users`, `PATCH /api/admin/users/:id/branch`
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`
- `POST /api/feedback`, `GET /api/feedback`
- `POST/GET /api/complaints`, `PATCH /api/complaints/:id`
- `GET /api/admin/users`, `GET/POST /api/admin/branches`, `GET /api/admin/export.csv`
- `GET /api/health`

All endpoints except health, login and registration require a valid bearer token. Role restrictions are enforced on the server. Staff can be assigned to a branch with the admin API; once assigned, their queue and complaint access is scoped to that branch. The default no-show grace period is 10 minutes and can be changed by an administrator (0–120 minutes). Queue order is computed server-side; clients cannot set queue positions directly.

## What the smart logic does
- **Service-time prediction:** an explainable weighted estimator (70% completed-service historical average + 30% service baseline), adjusted for time-of-day and active queue load. If historical data is unavailable, the service baseline is used. Predictions are labelled as estimates, not guarantees.
- **Queue order:** accessibility, senior-citizen, urgent and standard categories are ordered deterministically, then by slot. Priority changes are restricted to staff/admin queue actions and written to the audit log. The initial booking endpoint does not accept citizen-supplied priority.
- **Branch suggestions:** branch cards show active appointment counts so citizens can compare locations. Counts are local demo data, not a traffic-aware travel-time model.
- **Complaint routing:** simple keyword rules suggest a support team. Staff still need to review each ticket.

## Scope notes / production hardening
- QR tokens can be scanned by a client device or manually entered into `POST /api/queue/check-in`; this API accepts the token string after scanning/decoding. A browser-camera QR scanning UI is not bundled.
- SMS, WhatsApp, IVR, push notifications, voice input, external map routing and a trained ML model are not connected; the app uses in-app notifications and deterministic demo logic to avoid paid API dependencies.
- Before production, add rate limiting, email verification/password reset, CSRF protections if cookie auth is introduced, stricter audit logging, automated backups, privacy/retention policies, accessibility testing, deployment secrets management and a reviewed DPDP compliance process.
- Seed demo users share a known demo password. Never deploy the demo credentials to a public production environment.

## Testing
Run `npm test`. The included test suite checks the health endpoint and critical API/auth workflows using a temporary test database.

## Live queue demo and branch recommendations

- **Live queue** is visible to all signed-in roles and polls the public, privacy-preserving `/api/public/live-queue` feed every 10 seconds. It displays token, branch, service, queue position, status, counter and predicted wait without exposing customer names or phone numbers.
- The initial database seed includes 24 fictional customer accounts/tokens plus 126 completed historical sample records across three Chennai demo branches. These samples are for demonstrations and prediction baselines only, not real people or live government-office data.
- **Branches** uses Leaflet and OpenStreetMap tiles, branch pins, predicted wait and available-slot estimates. If external map tiles or the Leaflet CDN are unavailable, branch cards remain usable.
- The branch recommendation currently ranks by predicted wait and estimated available slots. It does not fabricate distances: distance-based ranking and routing require a user-provided location and a routing/geocoding provider. Branch coordinates are seeded sample locations in Chennai.
- The public queue endpoints are read-only. Staff/admin queue changes remain authenticated and backend-authorized.
