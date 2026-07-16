<script lang="ts">
	type Status = 'live' | 'updating' | 'stale' | 'error' | 'offline';

	interface Props {
		status: Status;
		lastUpdated: Date | null;
		now?: number;
	}

	let { status, lastUpdated, now = 0 }: Props = $props();

	const statusMeta = $derived.by(() => {
		switch (status) {
			case 'live':
				return { color: 'bg-emerald-500', label: 'Live', pulse: true };
			case 'updating':
				return { color: 'bg-sky-500', label: 'Updating…', pulse: true };
			case 'stale':
				return { color: 'bg-amber-500', label: 'Stale', pulse: false };
			case 'error':
				return { color: 'bg-rose-500', label: 'Error', pulse: false };
			case 'offline':
				return { color: 'bg-slate-500', label: 'Offline', pulse: false };
		}
	});

	const updatedLabel = $derived.by(() => {
		if (!lastUpdated) return 'never';
		const currentTime = now || Date.now();
		const diff = Math.max(0, Math.round((currentTime - lastUpdated.getTime()) / 1000));
		if (diff < 60) return `${diff}s ago`;
		return `${Math.round(diff / 60)}m ago`;
	});
</script>

<div
	class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs"
>
	<span class="relative flex h-2 w-2">
		{#if statusMeta.pulse}
			<span
				class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 {statusMeta.color}"
			></span>
		{/if}
		<span class="relative inline-flex h-2 w-2 rounded-full {statusMeta.color}"></span>
	</span>
	<span class="font-medium tracking-wide text-slate-300 uppercase">{statusMeta.label}</span>
	<span class="text-slate-500">·</span>
	<span class="text-slate-400">updated {updatedLabel}</span>
</div>
