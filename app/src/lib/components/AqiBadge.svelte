<script lang="ts">
	import type { AqiInfo } from '$lib/aqi';

	interface Props {
		info: AqiInfo | null;
		channel?: 'pm2_5' | 'pm10';
		size?: 'sm' | 'md' | 'lg';
	}

	let { info, channel = 'pm2_5', size = 'md' }: Props = $props();

	const channelLabel = $derived(channel === 'pm2_5' ? 'PM2.5' : 'PM10');
	const sizeClasses = $derived(
		size === 'lg' ? 'text-5xl sm:text-6xl' : size === 'sm' ? 'text-xl' : 'text-3xl sm:text-4xl'
	);
</script>

{#if info}
	<div
		class="inline-flex flex-col rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-sm backdrop-blur"
		style:--aqi-color={info.color}
	>
		<div class="flex items-baseline gap-2">
			<span class="font-mono font-semibold tabular-nums {sizeClasses}" style:color={info.color}>
				{info.aqi}
			</span>
			<span class="text-xs font-medium tracking-wide text-slate-500 uppercase">
				{channelLabel} AQI
			</span>
		</div>
		<div class="mt-1 text-sm font-medium" style:color={info.color}>{info.label}</div>
	</div>
{:else}
	<div
		class="inline-flex flex-col rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-sm"
	>
		<div class="flex items-baseline gap-2">
			<span class="font-mono text-3xl text-slate-400 sm:text-4xl">—</span>
			<span class="text-xs font-medium tracking-wide text-slate-500 uppercase">
				{channelLabel} AQI
			</span>
		</div>
		<div class="mt-1 text-sm text-slate-400">No data</div>
	</div>
{/if}
