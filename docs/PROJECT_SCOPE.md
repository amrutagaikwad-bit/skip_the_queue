# SkipTheQueue — Project Scope & Design Notes

## Roles
- **Citizen:** creates an account, chooses a service centre, books a slot, keeps a token, reschedules/cancels eligible appointments, receives updates, rates service and files support tickets.
- **Staff:** reviews appointments and queue entries, changes status through check-in/service/completion, reviews feedback and routes support work.
- **Admin:** reviews users, adds branches, monitors network metrics and exports appointment reports.

## Data model
- `users`: identity, password hash, role and language preference.
- `branches`: service-centre details and hours.
- `appointments`: citizen, branch, service, date, slot, token, status, priority and estimate.
- `notifications`: per-user in-app updates.
- `feedback`: rating and optional comment linked to a visit.
- `complaints`: support ticket, category, suggested team and status.

## State transitions
Appointment states used: `booked`, `waiting`, `checked_in`, `serving`, `completed`, `cancelled`, `no_show`. Citizens can cancel or reschedule only eligible appointments. Staff/admin can update operational status. Role checks are enforced in the API, not only the interface.

## Design principles
- Explain estimated time and make clear it is not guaranteed.
- Prefer server-side validation and parameterized SQL.
- Avoid paid integrations in the local demo.
- Show empty, error, and confirmation states instead of leaving dead controls.
- Keep the frontend responsive and usable on desktop and mobile.
