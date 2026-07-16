<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, untrack } from 'svelte';
	import LatestReading from '$lib/components/LatestReading.svelte';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import MetricSummary from '$lib/components/MetricSummary.svelte';
	import PmChart from '$lib/components/PmChart.svelte';
	import { formatNumber, formatTimestamp, relativeTime } from '$lib/aqi';
	import { downloadReadings, type ReadingExportFormat } from '$lib/export';
	import {
		fetchPmLogs,
		subscribePmLogsInsert,
		type PmLog,
		type RealtimeStatus
	} from '$lib/supabase';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	type RangeKey = '1h' | '24h' | '7d' | '30d' | 'all';
	type SeriesKey = 'pm1' | 'pm2_5' | 'pm10';
	type LiveStatus = 'live' | 'updating' | 'stale' | 'error' | 'offline';

	interface MetricStats {
		current: number | null;
		average: number | null;
		minimum: number | null;
		maximum: number | null;
		trend: number | null;
	}

	const MAX_LOGS = 1000;
	const MAX_HISTORY_ROWS = 50_000;
	const HISTORY_PAGE_SIZE = 1000;
	const MAX_CHART_POINTS = 1500;
	const MAX_CACHED_LOGS = 5000;
	const CACHE_WRITE_DELAY_MS = 400;
	const LOADING_ROWS = Array.from({ length: 12 }, (_, index) => index);
	const READINGS_CACHE_KEY = 'pms7003-readings-cache';
	const STALE_AFTER_MS = 3 * 60 * 1000;
	const RANGE_OPTIONS = [
		{ key: '1h', label: '1 hour', milliseconds: 60 * 60 * 1000 },
		{ key: '24h', label: '24 hours', milliseconds: 24 * 60 * 60 * 1000 },
		{ key: '7d', label: '7 days', milliseconds: 7 * 24 * 60 * 60 * 1000 },
		{ key: '30d', label: '30 days', milliseconds: 30 * 24 * 60 * 60 * 1000 },
		{ key: 'all', label: 'All loaded', milliseconds: null }
	] as const;

	const SERIES_OPTIONS: Array<{ key: SeriesKey; label: string }> = [
		{ key: 'pm1', label: 'PM1.0' },
		{ key: 'pm2_5', label: 'PM2.5' },
		{ key: 'pm10', label: 'PM10' }
	];

	let { data }: Props = $props();

	let logs = $state.raw<PmLog[]>(untrack(() => data.logs));
	let historyLogs = $state.raw<PmLog[]>(untrack(() => data.logs));
	let comparisonLogs = $state.raw<PmLog[]>([]);
	let error = $state<string | null>(untrack(() => data.error));
	let historyFetchError = $state<string | null>(null);
	let historyLoading = $state(false);
	let initialLoading = $state(
		untrack(() => data.configured && !data.error && data.logs.length === 0)
	);
	let configured = $state(untrack(() => data.configured));
	let now = $state(Date.now());
	let online = $state(true);
	let selectedRange = $state<RangeKey>('24h');
	let activeSeries = $state.raw<SeriesKey[]>(['pm1', 'pm2_5', 'pm10']);
	let unsubscribe: (() => void) | null = null;
	let historyAbortController: AbortController | null = null;
	let historyRequestId = 0;
	let manualRefreshInFlight = $state(false);
	let cacheWriteTimer: number | null = null;
	let pendingCachedReadings: PmLog[] | null = null;
	let liveStatus = $state<LiveStatus>(
		untrack(() => {
			if (!data.configured) return 'offline';
			if (data.error) return 'error';
			return 'updating';
		})
	);

	const latest = $derived(logs.length > 0 ? logs[0] : null);
	const lastUpdated = $derived(latest ? new Date(latest.created_at) : null);
	const recent = $derived(logs.slice(0, 12));
	const selectedRangeMilliseconds = $derived(
		RANGE_OPTIONS.find((option) => option.key === selectedRange)?.milliseconds ?? null
	);
	const selectedRangeLabel = $derived(
		RANGE_OPTIONS.find((option) => option.key === selectedRange)?.label ?? 'All loaded'
	);
	const comparisonLabel = $derived(
		selectedRange === 'all' ? 'previous period' : `previous ${selectedRangeLabel.toLowerCase()}`
	);
	const visibleLogs = $derived(historyLogs);
	const chartLogs = $derived.by(() => downsampleReadings(visibleLogs, MAX_CHART_POINTS));
	const isStale = $derived.by(() => {
		if (!latest) return false;
		const timestamp = new Date(latest.created_at).getTime();
		return Number.isFinite(timestamp) && now - timestamp > STALE_AFTER_MS;
	});
	const displayStatus = $derived<LiveStatus>(
		!online ? 'offline' : liveStatus === 'live' && isStale ? 'stale' : liveStatus
	);

	function downsampleReadings(readings: PmLog[], maxPoints: number): PmLog[] {
		if (readings.length <= maxPoints || maxPoints <= 1) return readings;
		return Array.from({ length: maxPoints }, (_, index) => {
			const position = Math.round((index * (readings.length - 1)) / (maxPoints - 1));
			return readings[position];
		});
	}

	function mergeLogs(...groups: PmLog[][]): PmLog[] {
		const byId: Record<string, PmLog> = {};
		for (const group of groups) {
			for (const row of group) byId[row.id] = row;
		}
		return Object.values(byId).sort((a, b) => b.created_at.localeCompare(a.created_at));
	}

	function isPmLog(value: unknown): value is PmLog {
		if (typeof value !== 'object' || value === null) return false;
		const row = value as Record<string, unknown>;
		return (
			typeof row.id === 'number' &&
			typeof row.created_at === 'string' &&
			Number.isFinite(row.pm1) &&
			Number.isFinite(row.pm2_5) &&
			Number.isFinite(row.pm10)
		);
	}

	function readCachedReadings(): PmLog[] {
		if (!browser) return [];
		try {
			const cached = JSON.parse(localStorage.getItem(READINGS_CACHE_KEY) ?? 'null');
			return Array.isArray(cached) ? cached.filter(isPmLog) : [];
		} catch {
			return [];
		}
	}

	function persistCachedReadings(...groups: PmLog[][]): void {
		if (!browser) return;

		const candidates = groups.flatMap((group) => group.slice(0, MAX_CACHED_LOGS));
		pendingCachedReadings = mergeLogs(candidates).slice(0, MAX_CACHED_LOGS);
		if (cacheWriteTimer !== null) return;

		cacheWriteTimer = window.setTimeout(() => {
			cacheWriteTimer = null;
			const readings = pendingCachedReadings;
			pendingCachedReadings = null;
			if (!readings) return;

			try {
				localStorage.setItem(READINGS_CACHE_KEY, JSON.stringify(readings));
			} catch {
				// Storage may be unavailable or full; live data should continue working.
			}
		}, CACHE_WRITE_DELAY_MS);
	}

	function storePreference(key: string, value: string): void {
		if (!browser) return;
		try {
			localStorage.setItem(key, value);
		} catch {
			// Preferences are optional and should never interrupt live data.
		}
	}

	function metricStats(
		readings: PmLog[],
		key: SeriesKey,
		comparisonReadings: PmLog[] = []
	): MetricStats {
		let current: number | null = null;
		let total = 0;
		let count = 0;
		let minimum = Infinity;
		let maximum = -Infinity;

		for (const reading of readings) {
			const value = reading[key];
			if (!Number.isFinite(value)) continue;
			current ??= value;
			total += value;
			count += 1;
			minimum = Math.min(minimum, value);
			maximum = Math.max(maximum, value);
		}

		if (count === 0 || current === null) {
			return { current: null, average: null, minimum: null, maximum: null, trend: null };
		}

		let comparisonTotal = 0;
		let comparisonCount = 0;
		for (const reading of comparisonReadings) {
			const value = reading[key];
			if (!Number.isFinite(value)) continue;
			comparisonTotal += value;
			comparisonCount += 1;
		}

		const average = total / count;
		const previousAverage = comparisonCount > 0 ? comparisonTotal / comparisonCount : null;

		return {
			current,
			average,
			minimum,
			maximum,
			trend:
				previousAverage !== null && previousAverage !== 0
					? ((average - previousAverage) / previousAverage) * 100
					: null
		};
	}

	const stats = $derived.by(() => ({
		pm1: metricStats(visibleLogs, 'pm1', comparisonLogs),
		pm2_5: metricStats(visibleLogs, 'pm2_5', comparisonLogs),
		pm10: metricStats(visibleLogs, 'pm10', comparisonLogs)
	}));

	function prependLog(row: PmLog) {
		if (!isPmLog(row)) return;
		const current = untrack(() => logs);
		if (current.some((existing) => existing.id === row.id)) return;
		const next = [row, ...current];
		next.sort((a, b) => b.created_at.localeCompare(a.created_at));
		logs = next.length > MAX_LOGS ? next.slice(0, MAX_LOGS) : next;

		const historyCutoff =
			selectedRangeMilliseconds === null ? null : Date.now() - selectedRangeMilliseconds;
		if (historyCutoff === null || new Date(row.created_at).getTime() >= historyCutoff) {
			const currentHistory = untrack(() => historyLogs);
			if (!currentHistory.some((existing) => existing.id === row.id)) {
				historyLogs = mergeLogs([row], currentHistory);
			}
		}

		persistCachedReadings(logs, historyLogs);
		initialLoading = false;
		error = null;
		if (liveStatus !== 'live') liveStatus = 'live';
	}

	async function loadHistory(range: RangeKey): Promise<void> {
		if (!browser || !configured) {
			initialLoading = false;
			return;
		}

		historyRequestId += 1;
		const requestId = historyRequestId;
		historyAbortController?.abort();
		historyAbortController = null;

		if (range === 'all') {
			historyLogs = logs;
			comparisonLogs = [];
			persistCachedReadings(logs);
			historyFetchError = null;
			historyLoading = false;
			initialLoading = false;
			return;
		}

		const milliseconds = RANGE_OPTIONS.find((option) => option.key === range)?.milliseconds ?? null;
		if (milliseconds === null) {
			initialLoading = false;
			return;
		}

		if (!navigator.onLine) {
			const cutoff = Date.now() - milliseconds;
			historyLogs = logs.filter((log) => new Date(log.created_at).getTime() >= cutoff);
			comparisonLogs = [];
			historyFetchError = null;
			historyLoading = false;
			initialLoading = false;
			return;
		}

		const controller = new AbortController();
		historyAbortController = controller;
		historyLoading = true;
		historyFetchError = null;
		comparisonLogs = [];
		const currentEndMs = Date.now();
		const currentStartMs = currentEndMs - milliseconds;
		const previousStartMs = currentStartMs - milliseconds;

		try {
			const [fresh, previous] = await Promise.all([
				fetchPmLogs({
					limit: MAX_HISTORY_ROWS,
					pageSize: HISTORY_PAGE_SIZE,
					from: new Date(currentStartMs).toISOString(),
					to: new Date(currentEndMs).toISOString(),
					signal: controller.signal
				}),
				fetchPmLogs({
					limit: MAX_HISTORY_ROWS,
					pageSize: HISTORY_PAGE_SIZE,
					from: new Date(previousStartMs).toISOString(),
					to: new Date(currentStartMs).toISOString(),
					signal: controller.signal
				})
			]);
			if (requestId !== historyRequestId) return;

			const latestRows = mergeLogs(
				untrack(() => logs),
				fresh.slice(0, MAX_LOGS)
			).slice(0, MAX_LOGS);
			logs = latestRows;
			historyLogs = mergeLogs(
				fresh,
				latestRows.filter((log) => {
					const timestamp = new Date(log.created_at).getTime();
					return timestamp >= currentStartMs && timestamp <= Date.now();
				})
			);
			comparisonLogs = previous;
			persistCachedReadings(logs, historyLogs);
			error = null;
		} catch (err) {
			if (controller.signal.aborted || requestId !== historyRequestId) return;
			historyFetchError =
				err instanceof Error ? err.message : 'Failed to load history from the data source.';
			if (untrack(() => logs).length === 0) {
				error = historyFetchError;
				liveStatus = 'error';
			}
		} finally {
			if (requestId === historyRequestId) {
				historyLoading = false;
				historyAbortController = null;
				initialLoading = false;
			}
		}
	}

	async function refresh(): Promise<void> {
		if (!browser || !configured || !navigator.onLine || manualRefreshInFlight) return;
		manualRefreshInFlight = true;
		liveStatus = 'updating';
		try {
			const fresh = await fetchPmLogs({ limit: 500 });
			logs = fresh.length > MAX_LOGS ? fresh.slice(0, MAX_LOGS) : fresh;
			persistCachedReadings(logs);
			error = null;
			liveStatus = 'live';
			await loadHistory(selectedRange);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to refresh readings.';
			liveStatus = 'error';
		} finally {
			manualRefreshInFlight = false;
		}
	}

	function openSubscription() {
		if (!browser || !configured || !navigator.onLine || unsubscribe) return;
		try {
			unsubscribe = subscribePmLogsInsert({
				onInsert: prependLog,
				onStatus: (status: RealtimeStatus) => {
					switch (status) {
						case 'live':
							liveStatus = 'live';
							break;
						case 'connecting':
							liveStatus = 'updating';
							break;
						case 'error':
							liveStatus = 'error';
							break;
						case 'offline':
							liveStatus = 'offline';
							break;
					}
				}
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to open realtime connection.';
			liveStatus = 'error';
		}
	}

	function closeSubscription() {
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
	}

	function toggleSeries(key: SeriesKey) {
		if (activeSeries.includes(key)) {
			if (activeSeries.length === 1) return;
			activeSeries = activeSeries.filter((series) => series !== key);
		} else {
			activeSeries = [...activeSeries, key];
		}
		storePreference('pms7003-series', JSON.stringify(activeSeries));
	}

	function setRange(range: RangeKey) {
		selectedRange = range;
		storePreference('pms7003-range', range);
		void loadHistory(range);
	}

	function exportVisibleReadings(format: ReadingExportFormat) {
		if (!browser || visibleLogs.length === 0) return;
		downloadReadings(visibleLogs, format, `pms7003-${selectedRange}`);
	}

	onMount(() => {
		const cached = readCachedReadings();
		if (cached.length > 0) {
			logs = mergeLogs(logs, cached).slice(0, MAX_LOGS);
			historyLogs = logs;
			initialLoading = false;
		}

		try {
			const savedRange = localStorage.getItem('pms7003-range');
			if (RANGE_OPTIONS.some((option) => option.key === savedRange)) {
				selectedRange = savedRange as RangeKey;
			}

			const savedSeries = JSON.parse(localStorage.getItem('pms7003-series') ?? 'null');
			if (Array.isArray(savedSeries)) {
				const validSeries = savedSeries.filter((series): series is SeriesKey =>
					SERIES_OPTIONS.some((option) => option.key === series)
				);
				if (validSeries.length > 0) activeSeries = validSeries;
			}
		} catch {
			// Ignore malformed browser preferences and keep the defaults.
		}

		const initialOnline = navigator.onLine;
		online = initialOnline;
		if (initialOnline && !document.hidden) openSubscription();
		else liveStatus = 'offline';
		void loadHistory(selectedRange);

		const clockTimer = window.setInterval(() => {
			now = Date.now();
		}, 1_000);
		const handleOnline = () => {
			online = true;
			refresh();
			openSubscription();
		};
		const handleOffline = () => {
			online = false;
			closeSubscription();
			liveStatus = 'offline';
		};
		const handleVisibility = () => {
			if (document.hidden) {
				closeSubscription();
			} else if (navigator.onLine) {
				refresh();
				openSubscription();
			}
		};

		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			window.clearInterval(clockTimer);
			historyAbortController?.abort();
			if (cacheWriteTimer !== null) window.clearTimeout(cacheWriteTimer);
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			document.removeEventListener('visibilitychange', handleVisibility);
			closeSubscription();
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

<div class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-[0.3em] text-sky-400 uppercase">PMS7003 monitor</p>
			<h1 class="mt-1 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
				Air quality dashboard
			</h1>
			<p class="mt-2 max-w-xl text-sm text-slate-400">
				Live PM1.0, PM2.5 and PM10 readings. Use the controls below to explore the data currently
				available to this dashboard.
			</p>
		</div>
		<div class="flex flex-wrap items-center justify-end gap-2">
			<LiveIndicator status={displayStatus} {lastUpdated} {now} />
			<button
				type="button"
				onclick={refresh}
				disabled={!configured || !online || manualRefreshInFlight}
				aria-busy={manualRefreshInFlight}
				class="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
			>
				{#if manualRefreshInFlight}
					<span
						class="h-3 w-3 animate-spin rounded-full border-2 border-sky-300 border-t-transparent"
						aria-hidden="true"
					></span>
					Refreshing
				{:else}
					Refresh
				{/if}
			</button>
		</div>
	</header>

	{#if !configured}
		<div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-200">
			<h2 class="text-base font-semibold text-amber-100">Supabase not configured</h2>
			<p class="mt-2 text-amber-200/80">
				Set <code class="rounded bg-amber-500/20 px-1.5 py-0.5">PUBLIC_SUPABASE_URL</code> and
				<code class="rounded bg-amber-500/20 px-1.5 py-0.5">PUBLIC_SUPABASE_ANON_KEY</code> in your environment
				and restart the dev server.
			</p>
		</div>
	{:else if error && logs.length === 0}
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
		<div class="relative" aria-busy={initialLoading || historyLoading}>
			<div
				class="absolute inset-0 z-30 flex flex-col gap-4 rounded-3xl bg-slate-950/80 p-4 backdrop-blur-sm transition-opacity duration-300 ease-out sm:p-6 {initialLoading
					? 'pointer-events-auto opacity-100'
					: 'pointer-events-none opacity-0'}"
				role="status"
				aria-live="polite"
				aria-busy={initialLoading}
				aria-hidden={!initialLoading}
			>
				<div
					class="flex items-center gap-2 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm text-sky-200"
				>
					<span
						class="h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-transparent"
						aria-hidden="true"
					></span>
					Loading the latest air-quality readings…
				</div>
				<div class="h-56 animate-pulse rounded-3xl border border-white/10 bg-white/5"></div>
				<div class="grid gap-3 md:grid-cols-3">
					<div class="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/5"></div>
					<div class="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/5"></div>
					<div class="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/5"></div>
				</div>
				<div class="h-96 animate-pulse rounded-3xl border border-white/10 bg-white/5"></div>
			</div>

			{#if !online}
				<div
					class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
					role="status"
				>
					<span class="font-medium text-amber-100">You’re offline.</span>
					Showing the last readings available in this browser.
				</div>
			{:else if error}
				<div
					class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200"
					role="alert"
				>
					<span>{error}</span>
					<button
						type="button"
						onclick={refresh}
						class="rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/30"
					>
						Retry
					</button>
				</div>
			{/if}

			<LatestReading reading={latest} {now} />

			<section class="space-y-4" aria-labelledby="overview-heading" aria-busy={historyLoading}>
				<div class="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h2 id="overview-heading" class="text-lg font-semibold text-slate-100">Overview</h2>
						<p class="mt-1 text-xs text-slate-500">
							{#if historyLoading}
								<span class="text-sky-300" role="status" aria-live="polite"
									>Loading {selectedRangeLabel.toLowerCase()} from the database…</span
								>
							{:else if historyFetchError}
								<span class="text-rose-300" role="alert">{historyFetchError}</span>
							{:else}
								{visibleLogs.length} sample{visibleLogs.length === 1 ? '' : 's'} in
								{selectedRangeLabel.toLowerCase()} · {logs.length} latest loaded
							{/if}
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<div
							class="flex rounded-xl border border-white/10 bg-white/5 p-1"
							role="group"
							aria-label="History range"
						>
							{#each RANGE_OPTIONS as option (option.key)}
								<button
									type="button"
									class="rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 {selectedRange ===
									option.key
										? 'bg-sky-400 text-slate-950'
										: 'text-slate-400 hover:bg-white/10 hover:text-slate-200'}"
									aria-pressed={selectedRange === option.key}
									onclick={() => setRange(option.key)}
								>
									{option.key === 'all' ? 'All' : option.key}
								</button>
							{/each}
						</div>

						<div class="flex gap-2">
							<button
								type="button"
								aria-label="Download visible readings as CSV"
								disabled={visibleLogs.length === 0}
								onclick={() => exportVisibleReadings('csv')}
								class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
							>
								CSV
							</button>
							<button
								type="button"
								aria-label="Download visible readings as JSON"
								disabled={visibleLogs.length === 0}
								onclick={() => exportVisibleReadings('json')}
								class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
							>
								JSON
							</button>
						</div>
					</div>
				</div>

				<div class="grid gap-3 md:grid-cols-3">
					<MetricSummary label="PM1.0" accent="#38bdf8" {comparisonLabel} {...stats.pm1} />
					<MetricSummary label="PM2.5" accent="#f97316" {comparisonLabel} {...stats.pm2_5} />
					<MetricSummary label="PM10" accent="#a78bfa" {comparisonLabel} {...stats.pm10} />
				</div>
			</section>

			<section
				class="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6"
				aria-labelledby="chart-heading"
				aria-busy={historyLoading}
			>
				<div class="mb-4 flex flex-wrap items-baseline justify-between gap-3 px-2">
					<div>
						<h2 id="chart-heading" class="text-lg font-semibold text-slate-100">History</h2>
						<p class="text-xs text-slate-500">
							Hover a point for its exact value · click a legend item to hide a series · history is
							fetched from the data source
						</p>
					</div>
					{#if historyFetchError}
						<button
							type="button"
							onclick={() => void loadHistory(selectedRange)}
							class="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
						>
							Retry history
						</button>
					{:else}
						<span class="text-xs text-slate-500">
							{visibleLogs.length} readings · chart shows {chartLogs.length}
						</span>
					{/if}
				</div>
				<div class="relative">
					<PmChart logs={chartLogs} {activeSeries} onToggleSeries={toggleSeries} />
					{#if historyLoading}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
							<div
								class="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-sky-200 backdrop-blur"
							>
								Updating chart…
							</div>
						</div>
					{/if}
				</div>
			</section>

			<section
				class="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6"
				aria-labelledby="recent-heading"
			>
				<div class="mb-4 flex items-baseline justify-between gap-3 px-2">
					<div>
						<h2 id="recent-heading" class="text-lg font-semibold text-slate-100">Recent samples</h2>
						<p class="mt-1 text-xs text-slate-500">
							The latest readings currently available to the app
						</p>
					</div>
					<span class="text-xs text-slate-500">Showing {recent.length}</span>
				</div>

				<div class="overflow-x-auto">
					<table class="w-full min-w-[28rem] text-left text-sm">
						<caption class="sr-only">Recent PM1.0, PM2.5, and PM10 readings</caption>
						<thead>
							<tr class="text-xs tracking-wide text-slate-500 uppercase">
								<th class="px-3 py-2 font-medium">Recorded</th>
								<th class="px-3 py-2 text-right font-medium">PM1.0</th>
								<th class="px-3 py-2 text-right font-medium">PM2.5</th>
								<th class="px-3 py-2 text-right font-medium">PM10</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-white/5">
							{#if initialLoading}
								{#each LOADING_ROWS as row (row)}
									<tr>
										<td colspan="4" class="px-3 py-2">
											<div class="h-8 animate-pulse rounded bg-white/5"></div>
										</td>
									</tr>
								{/each}
							{:else}
								{#each recent as log (log.id)}
									<tr class="text-slate-300">
										<td class="px-3 py-2">
											<div class="flex flex-col">
												<span class="text-slate-100"
													>{relativeTime(log.created_at, new Date(now))}</span
												>
												<span class="text-xs text-slate-500">{formatTimestamp(log.created_at)}</span
												>
											</div>
										</td>
										<td class="px-3 py-2 text-right font-mono tabular-nums"
											>{formatNumber(log.pm1)}</td
										>
										<td class="px-3 py-2 text-right font-mono tabular-nums"
											>{formatNumber(log.pm2_5)}</td
										>
										<td class="px-3 py-2 text-right font-mono tabular-nums"
											>{formatNumber(log.pm10)}</td
										>
									</tr>
								{:else}
									<tr>
										<td colspan="4" class="px-3 py-8 text-center text-slate-500">
											No samples yet — readings will appear here when the data source is online.
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	{/if}

	<footer class="pt-4 text-center text-xs text-slate-600">
		AQI computed from EPA breakpoints · μg/m³ = micrograms per cubic metre
	</footer>
</div>
