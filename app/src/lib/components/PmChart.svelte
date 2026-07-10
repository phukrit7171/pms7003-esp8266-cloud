<script lang="ts">
	import type { PmLog } from '$lib/supabase';

	interface Props {
		logs: PmLog[];
		height?: number;
	}

	let { logs, height = 320 }: Props = $props();

	type Series = {
		key: 'pm1' | 'pm2_5' | 'pm10';
		label: string;
		color: string;
	};

	type Point = {
		t: number;
		pm1: number;
		pm2_5: number;
		pm10: number;
	};

	const SERIES: Series[] = [
		{ key: 'pm1', label: 'PM1.0', color: '#38bdf8' },
		{ key: 'pm2_5', label: 'PM2.5', color: '#f97316' },
		{ key: 'pm10', label: 'PM10', color: '#a78bfa' }
	];

	const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

	const points = $derived<Point[]>(
		logs
			.map((log) => ({
				t: new Date(log.created_at).getTime(),
				pm1: log.pm1,
				pm2_5: log.pm2_5,
				pm10: log.pm10
			}))
			.filter((p) => Number.isFinite(p.t))
			.sort((a, b) => a.t - b.t)
	);

	const hasData = $derived(points.length > 0);

	const bounds = $derived.by(() => {
		if (!hasData) return { xMin: 0, xMax: 1, yMin: 0, yMax: 100 };
		const xs = points.map((p) => p.t);
		const ys = points.flatMap((p) => [p.pm1, p.pm2_5, p.pm10]);
		const yMaxRaw = Math.max(...ys, 10);
		const yMin = 0;
		const yMax = Math.ceil(yMaxRaw / 10) * 10;
		return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin, yMax };
	});

	let containerWidth = $state(800);

	function trackWidth(node: HTMLDivElement) {
		containerWidth = node.clientWidth;
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				containerWidth = entry.contentRect.width;
			}
		});
		ro.observe(node);
		return () => ro.disconnect();
	}

	const innerWidth = $derived(Math.max(50, containerWidth - PAD.left - PAD.right));
	const innerHeight = $derived(height - PAD.top - PAD.bottom);

	function xScale(t: number): number {
		if (!hasData || bounds.xMax === bounds.xMin) return PAD.left + innerWidth / 2;
		return PAD.left + ((t - bounds.xMin) / (bounds.xMax - bounds.xMin)) * innerWidth;
	}

	function yScale(v: number): number {
		if (bounds.yMax === bounds.yMin) return PAD.top + innerHeight / 2;
		return PAD.top + innerHeight - ((v - bounds.yMin) / (bounds.yMax - bounds.yMin)) * innerHeight;
	}

	function buildPath(key: Series['key']): string {
		if (!hasData) return '';
		return points
			.map((p, i) => {
				const x = xScale(p.t);
				const y = yScale(p[key]);
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
			})
			.join(' ');
	}

	const yTicks = $derived.by(() => {
		const count = 4;
		const step = (bounds.yMax - bounds.yMin) / count;
		return Array.from({ length: count + 1 }, (_, i) => bounds.yMin + step * i);
	});

	function formatTick(t: number): string {
		const d = new Date(t);
		const now = Date.now();
		const diffMs = now - t;
		const sameDay = new Date(now).toDateString() === d.toDateString();
		if (diffMs < 24 * 60 * 60 * 1000 && sameDay) {
			return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
		}
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	const xTickPositions = $derived.by(() => {
		if (!hasData) return [] as { t: number; label: string }[];
		const start = bounds.xMin;
		const end = bounds.xMax;
		const steps = Math.max(2, Math.min(6, points.length));
		return Array.from({ length: steps }, (_, i) => {
			const t = start + ((end - start) * i) / (steps - 1);
			return { t, label: formatTick(t) };
		});
	});
</script>

<div {@attach trackWidth} class="w-full" style:height="{height}px">
	<svg
		viewBox="0 0 {containerWidth} {height}"
		width="100%"
		{height}
		role="img"
		aria-label="PM1.0, PM2.5 and PM10 over time"
	>
		<defs>
			<linearGradient id="chart-bg" x1="0" x2="0" y1="0" y2="1">
				<stop offset="0%" stop-color="#0f172a" stop-opacity="0.4" />
				<stop offset="100%" stop-color="#0f172a" stop-opacity="0" />
			</linearGradient>
		</defs>

		<rect x="0" y="0" width={containerWidth} {height} fill="url(#chart-bg)" rx="16" />

		{#if hasData}
			{#each yTicks as tick, i (i)}
				<line
					x1={PAD.left}
					x2={containerWidth - PAD.right}
					y1={yScale(tick)}
					y2={yScale(tick)}
					stroke="#1e293b"
					stroke-width="1"
					stroke-dasharray={tick === 0 ? '0' : '2 4'}
				/>
				<text
					x={PAD.left - 8}
					y={yScale(tick)}
					text-anchor="end"
					dominant-baseline="middle"
					class="fill-slate-500 font-mono text-[10px]"
				>
					{Math.round(tick)}
				</text>
			{/each}

			{#each xTickPositions as tick, i (i)}
				<text
					x={xScale(tick.t)}
					y={height - 8}
					text-anchor="middle"
					class="fill-slate-500 text-[10px]"
				>
					{tick.label}
				</text>
			{/each}

			{#each SERIES as series (series.key)}
				<path
					d={buildPath(series.key)}
					fill="none"
					stroke={series.color}
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					opacity="0.9"
				/>
			{/each}

			{#each SERIES as series (series.key)}
				{#each points as p, i (i + '-' + series.key)}
					<circle
						cx={xScale(p.t)}
						cy={yScale(p[series.key])}
						r="2"
						fill={series.color}
						opacity="0.6"
					/>
				{/each}
			{/each}
		{:else}
			<text
				x={containerWidth / 2}
				y={height / 2}
				text-anchor="middle"
				dominant-baseline="middle"
				class="fill-slate-500 text-sm"
			>
				Waiting for the first sample…
			</text>
		{/if}
	</svg>
</div>

<div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
	{#each SERIES as series (series.key)}
		<span class="inline-flex items-center gap-1.5">
			<span
				class="inline-block h-2 w-3 rounded-sm"
				style:background-color={series.color}
				aria-hidden="true"
			></span>
			{series.label}
		</span>
	{/each}
	<span class="ml-auto text-slate-500">
		{points.length} sample{points.length === 1 ? '' : 's'}
	</span>
</div>
