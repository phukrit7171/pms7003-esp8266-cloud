<script lang="ts">
	import { formatNumber } from '$lib/aqi';

	interface Props {
		label: string;
		current: number | null;
		average: number | null;
		minimum: number | null;
		maximum: number | null;
		trend: number | null;
		accent: string;
		comparisonLabel?: string;
	}

	let {
		label,
		current,
		average,
		minimum,
		maximum,
		trend,
		accent,
		comparisonLabel = 'previous period'
	}: Props = $props();

	const trendLabel = $derived(
		trend === null
			? 'No comparison data'
			: `${trend >= 0 ? '+' : ''}${formatNumber(trend, 1)}% vs ${comparisonLabel}`
	);
	const trendClass = $derived(
		trend === null ? 'text-slate-500' : trend > 0 ? 'text-amber-300' : 'text-emerald-300'
	);
</script>

<article class="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
	<div class="flex items-center justify-between gap-3">
		<p class="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</p>
		<span class="h-2 w-2 rounded-full" style:background-color={accent} aria-hidden="true"></span>
	</div>

	<p class="mt-2 font-mono text-3xl font-semibold text-slate-50 tabular-nums">
		{formatNumber(current)}
		<span class="text-xs font-normal text-slate-500">μg/m³</span>
	</p>

	<div class="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-xs">
		<div>
			<p class="text-slate-500">Average</p>
			<p class="mt-0.5 font-mono text-slate-300 tabular-nums">{formatNumber(average)}</p>
		</div>
		<div>
			<p class="text-slate-500">Low</p>
			<p class="mt-0.5 font-mono text-slate-300 tabular-nums">{formatNumber(minimum)}</p>
		</div>
		<div>
			<p class="text-slate-500">High</p>
			<p class="mt-0.5 font-mono text-slate-300 tabular-nums">{formatNumber(maximum)}</p>
		</div>
	</div>

	<p class="mt-3 text-xs {trendClass}">{trendLabel}</p>
</article>
