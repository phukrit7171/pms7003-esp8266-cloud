<script lang="ts">
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import LatestReading from '$lib/components/LatestReading.svelte';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import PmChart from '$lib/components/PmChart.svelte';
	import { formatNumber, formatTimestamp, relativeTime } from '$lib/aqi';
	import { fetchPmLogs, type PmLog } from '$lib/supabase';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const POLL_MS = 30_000;

	let logs = $state<PmLog[]>(untrack(() => data.logs));
	let error = $state<string | null>(untrack(() => data.error));
	let configured = $state(untrack(() => data.configured));
	let lastUpdated = $state<Date | null>(
		untrack(() => (data.fetchedAt ? new Date(data.fetchedAt) : null))
	);
	let pollHandle: ReturnType<typeof setInterval> | null = null;
	let inFlight: AbortController | null = null;

	type LiveStatus = 'live' | 'updating' | 'stale' | 'error' | 'offline';
	let liveStatus = $state<LiveStatus>(untrack(() => (data.logs.length > 0 ? 'live' : 'offline')));

	const latest = $derived(logs.length > 0 ? logs[0] : null);
	const recent = $derived(logs.slice(0, 12));
	const totals = $derived({
		samples: logs.length,
		latestPm25: latest?.pm2_5 ?? null,
		latestAt: latest?.created_at ?? null
	});

	async function refresh() {
		if (!browser || !configured) return;
		inFlight?.abort();
		const ctrl = new AbortController();
		inFlight = ctrl;
		liveStatus = 'updating';
		try {
			const fresh = await fetchPmLogs({ limit: 500, signal: ctrl.signal });
			logs = fresh;
			error = null;
			lastUpdated = new Date();
			liveStatus = 'live';
		} catch (err) {
			if ((err as { name?: string })?.name === 'AbortError') return;
			error = err instanceof Error ? err.message : 'Failed to refresh readings.';
			liveStatus = 'error';
		}
	}

	function startPolling() {
		if (!browser || !configured || pollHandle !== null) return;
		pollHandle = setInterval(refresh, POLL_MS);
	}

	function stopPolling() {
		if (pollHandle !== null) {
			clearInterval(pollHandle);
			pollHandle = null;
		}
		inFlight?.abort();
		inFlight = null;
	}

	$effect(() => {
		if (!browser) return;
		const handleVisibility = () => {
			if (document.hidden) {
				stopPolling();
			} else {
				refresh();
				startPolling();
			}
		};
		document.addEventListener('visibilitychange', handleVisibility);
		startPolling();
		return () => {
			document.removeEventListener('visibilitychange', handleVisibility);
			stopPolling();
		};
	});
</script>

<svelte:head>
	<title>Air quality · PMS7003</title>
	<meta
		name="description"
		content="Live PM1.0 / PM2.5 / PM10 readings from a PMS7003 sensor on a WeMos D1 R1."
	/>
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-[0.3em] text-sky-400 uppercase">PMS7003 monitor</p>
			<h1 class="mt-1 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
				Air quality dashboard
			</h1>
			<p class="mt-2 max-w-xl text-sm text-slate-400">
				Live PM1.0, PM2.5 and PM10 from a WeMos D1 R1 + PMS7003 sensor. EPA AQI is computed on the
				PM2.5 channel.
			</p>
		</div>
		<LiveIndicator status={liveStatus} {lastUpdated} />
	</header>

	{#if !configured}
		<div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-200">
			<h2 class="text-base font-semibold text-amber-100">Supabase not configured</h2>
			<p class="mt-2 text-amber-200/80">
				Set <code class="rounded bg-amber-500/20 px-1.5 py-0.5">PUBLIC_SUPABASE_URL</code> and
				<code class="rounded bg-amber-500/20 px-1.5 py-0.5">PUBLIC_SUPABASE_ANON_KEY</code> in your
				environment (see <code>.env.example</code>) and restart the dev server.
			</p>
		</div>
	{:else if error}
		<div class="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
			<h2 class="text-base font-semibold text-rose-100">Couldn’t load readings</h2>
			<p class="mt-2 text-rose-200/80">{error}</p>
			<button
				type="button"
				onclick={refresh}
				class="mt-3 inline-flex items-center rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/30"
			>
				Retry
			</button>
		</div>
	{:else}
		<LatestReading reading={latest} />

		<section
			class="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6"
			aria-labelledby="chart-heading"
		>
			<div class="mb-4 flex flex-wrap items-baseline justify-between gap-3 px-2">
				<div>
					<h2 id="chart-heading" class="text-lg font-semibold text-slate-100">History</h2>
					<p class="text-xs text-slate-500">
						{totals.samples} sample{totals.samples === 1 ? '' : 's'} loaded · refreshes every
						{POLL_MS / 1000}s
					</p>
				</div>
			</div>
			<PmChart {logs} />
		</section>

		<section
			class="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6"
			aria-labelledby="recent-heading"
		>
			<div class="mb-4 flex items-baseline justify-between gap-3 px-2">
				<h2 id="recent-heading" class="text-lg font-semibold text-slate-100">Recent samples</h2>
				<span class="text-xs text-slate-500">Showing the latest {recent.length}</span>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full min-w-[28rem] text-left text-sm">
					<thead>
						<tr class="text-xs tracking-wide text-slate-500 uppercase">
							<th class="px-3 py-2 font-medium">Recorded</th>
							<th class="px-3 py-2 text-right font-medium">PM1.0</th>
							<th class="px-3 py-2 text-right font-medium">PM2.5</th>
							<th class="px-3 py-2 text-right font-medium">PM10</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-white/5">
						{#each recent as log (log.id)}
							<tr class="text-slate-300">
								<td class="px-3 py-2">
									<div class="flex flex-col">
										<span class="text-slate-100">{relativeTime(log.created_at)}</span>
										<span class="text-xs text-slate-500">{formatTimestamp(log.created_at)}</span>
									</div>
								</td>
								<td class="px-3 py-2 text-right font-mono tabular-nums">
									{formatNumber(log.pm1)}
								</td>
								<td class="px-3 py-2 text-right font-mono tabular-nums">
									{formatNumber(log.pm2_5)}
								</td>
								<td class="px-3 py-2 text-right font-mono tabular-nums">
									{formatNumber(log.pm10)}
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="4" class="px-3 py-8 text-center text-slate-500">
									No samples yet — the firmware uploads every minute when the sensor is online.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<footer class="pt-4 text-center text-xs text-slate-600">
		AQI computed from EPA breakpoints · μ/m³ = micrograms per cubic metre
	</footer>
</div>
