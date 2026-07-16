<script lang="ts">
	import AqiBadge from './AqiBadge.svelte';
	import { formatNumber, formatTimestamp, pm25Info, relativeTime } from '$lib/aqi';
	import type { PmLog } from '$lib/supabase';

	interface Props {
		reading: PmLog | null;
		now?: number;
	}

	let { reading, now = 0 }: Props = $props();

	const pm25 = $derived(reading?.pm2_5 ?? null);
	const pm10 = $derived(reading?.pm10 ?? null);
	const pm25Aqi = $derived(pm25 === null ? null : pm25Info(pm25));
	const recordedAt = $derived(reading?.created_at ?? null);
	const recordedRel = $derived(relativeTime(recordedAt, now ? new Date(now) : new Date()));
</script>

<section
	class="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-6 shadow-lg ring-1 ring-white/5 sm:p-8"
>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">Latest reading</p>
			<h2 class="mt-1 text-2xl font-semibold text-slate-50 sm:text-3xl">
				{reading ? 'Live sample' : 'No data yet'}
			</h2>
			{#if recordedAt}
				<p class="mt-1 text-sm text-slate-400">
					<span title={formatTimestamp(recordedAt)}>{recordedRel}</span>
					<span class="text-slate-600"> · </span>
					<span>{formatTimestamp(recordedAt)}</span>
				</p>
			{/if}
		</div>

		<AqiBadge info={pm25Aqi} channel="pm2_5" size="lg" />
	</div>

	<div class="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
		<div class="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
			<p class="text-xs font-medium tracking-wide text-slate-400 uppercase">PM1.0</p>
			<p class="mt-1 font-mono text-2xl font-semibold text-slate-50 tabular-nums sm:text-3xl">
				{formatNumber(reading?.pm1 ?? null)}
			</p>
			<p class="mt-0.5 text-xs text-slate-500">μg/m³</p>
		</div>
		<div class="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
			<p class="text-xs font-medium tracking-wide text-slate-400 uppercase">PM2.5</p>
			<p class="mt-1 font-mono text-2xl font-semibold text-slate-50 tabular-nums sm:text-3xl">
				{formatNumber(pm25)}
			</p>
			<p class="mt-0.5 text-xs text-slate-500">μg/m³</p>
		</div>
		<div class="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
			<p class="text-xs font-medium tracking-wide text-slate-400 uppercase">PM10</p>
			<p class="mt-1 font-mono text-2xl font-semibold text-slate-50 tabular-nums sm:text-3xl">
				{formatNumber(pm10)}
			</p>
			<p class="mt-0.5 text-xs text-slate-500">μg/m³</p>
		</div>
	</div>
</section>
