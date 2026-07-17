# PMS7003 dashboard

The SvelteKit dashboard displays the latest PM1.0, PM2.5, and PM10 samples from Supabase. It loads recent history over PostgREST and receives new rows through Supabase Realtime.

## Configure

Copy `.env.example` to `.env` and set the public project URL and anon key:

```bash
PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The `pm_logs` table, RLS policies, and `supabase_realtime` publication are documented in the repository [README](../README.md#-supabase-setup).

## Develop

```bash
pnpm install
pnpm dev
```

## Verify and build

```bash
pnpm test
pnpm check
pnpm lint
pnpm build
```

The app uses `@sveltejs/adapter-vercel` and is ready to deploy to Vercel once the two public environment variables are configured there.
