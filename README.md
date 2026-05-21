# סוכן לימודים חכם - Hebrew AI Student Productivity Agent

Next.js + TypeScript MVP for a Hebrew student productivity agent. The app uses the existing Supabase project and existing tables (`users`, `messages`, `tasks`, `task_sessions`) instead of rebuilding the database.

## What Is Included

- Hebrew RTL web app.
- Supabase Auth with email magic link and Google login.
- Chat in Hebrew with the last 10 saved messages as memory.
- Message persistence in `public.messages`.
- Task and deadline management in `public.tasks`.
- Google Calendar connection status and upcoming event reading.
- Free-window based study-session recommendations.
- Approval-first calendar flow: the app creates a Google Calendar event only after the user clicks `אשר שיבוץ`.
- Recommendation status flow: `ממתין לאישור`, `שובץ ביומן`, `הושלם`, `נדחה`.

## Existing Supabase Project

Project inspected:

- Name: `MyAI Manager`
- Ref: `sfbsxqapnjbjcxlvubor`
- URL: `https://sfbsxqapnjbjcxlvubor.supabase.co`

Existing tables were preserved. A minimal migration was applied to make them usable and safer for this app:

- `tasks.tasks_id` is now the primary key, so each user can have multiple tasks.
- `task_sessions.task_id` is no longer unique, so a task can have multiple study sessions.
- Added `tasks.description`.
- Added `task_sessions.reason`, `task_sessions.google_calendar_event_id`, `task_sessions.updated_at`.
- Replaced broad testing RLS policies with authenticated per-user policies based on `auth.uid()`.
- Revoked anonymous table access and granted scoped authenticated access.
- Added indexes used by chat/task/recommendation queries.

Security advisor returned no findings after the migration.

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://sfbsxqapnjbjcxlvubor.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_dTY8rW8GcU50vcc5xHcZow_LKyApcXi

OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5.2

GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_TIME_ZONE=Asia/Jerusalem
```

Notes:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is safe for the browser.
- Never expose a Supabase service role key in `NEXT_PUBLIC_*`.
- `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are server-side only.

## Supabase Auth Setup

In Supabase Auth settings:

1. Enable email magic links if you want email login.
2. Enable Google provider for login/calendar connection.
3. Add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - Your deployed app URL, for example `https://your-domain.com/auth/callback`
4. For Google Calendar, request these scopes:
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`

The app stores Google OAuth tokens in the existing `users.google_access_token` and `users.google_refresh_token` columns. For a later production hardening pass, move those tokens to a private schema or Supabase Vault with a service-role-only server path.

## Google Calendar Flow

1. User connects Google Calendar.
2. App reads upcoming events on the server.
3. App finds free windows during normal study hours.
4. User creates recommendations.
5. Recommendations are saved in `task_sessions` with `pending` status.
6. User clicks `אשר שיבוץ`.
7. Only then the server creates the Google Calendar event and updates the session to `scheduled`.

## OpenAI Behavior

The chat API route stores the user message, loads the last 10 messages, includes current tasks/recommendations/calendar context, and calls the OpenAI Responses API.

If `OPENAI_API_KEY` is missing, the app still works with a simple Hebrew fallback response, but real AI answers require the key.

## Hostinger and n8n

The available Hostinger connector in this workspace did not expose SSH/server inspection or n8n workflow listing. Because of that, the MVP implements the automation logic directly in Next.js API routes:

- `/api/recommendations/generate`
- `/api/recommendations/[id]`
- `/api/chat`

n8n is not required for the MVP. If you want n8n later, the clean integration is:

1. Create an n8n webhook workflow, for example `POST /webhook/student-agent/recommend`.
2. Send authenticated task/calendar payloads from the app server to that webhook.
3. Let n8n run extra automation, reminders, Telegram messages, or background jobs.
4. Return recommendations to the app, then store them in `task_sessions`.

Do not call n8n directly from the browser if the webhook needs secrets.

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful checks:

```bash
npm run typecheck
npm run build
```

## Main Files

- `app/app/page.tsx` - protected app entry.
- `components/student-agent-app.tsx` - main Hebrew UI.
- `app/api/chat/route.ts` - chat persistence and AI response.
- `app/api/tasks/route.ts` - task creation.
- `app/api/recommendations/generate/route.ts` - scheduling recommendation generation.
- `app/api/recommendations/[id]/route.ts` - approve/reject/complete flow.
- `lib/scheduling.ts` - free-window and ranking engine.
- `lib/google-calendar.ts` - Google Calendar read/create helpers.
- `lib/supabase/*` - Supabase SSR clients and session proxy.
