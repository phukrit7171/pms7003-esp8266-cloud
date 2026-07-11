import { browser } from '$app/environment';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';

export interface PmLog {
	id: number;
	pm1: number;
	pm2_5: number;
	pm10: number;
	created_at: string;
}

export interface SupabaseConfig {
	url: string;
	anonKey: string;
}

function readConfig(): SupabaseConfig {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;
	return { url: url ?? '', anonKey: anonKey ?? '' };
}

export function hasSupabaseConfig(): boolean {
	const { url, anonKey } = readConfig();
	return url.length > 0 && anonKey.length > 0;
}

export type RealtimeStatus = 'connecting' | 'live' | 'error' | 'offline';

function requireBrowser(): void {
	if (!browser) {
		throw new Error('Supabase realtime must run in the browser.');
	}
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
	requireBrowser();
	if (client) return client;

	const { url, anonKey } = readConfig();
	if (!url || !anonKey) {
		throw new Error('Supabase is not configured.');
	}

	client = createClient(url, anonKey, {
		realtime: { params: { eventsPerSecond: 10 } }
	});
	return client;
}

export async function fetchPmLogs(
	opts: { limit?: number; signal?: AbortSignal; fetcher?: typeof fetch } = {}
): Promise<PmLog[]> {
	const { url, anonKey } = readConfig();
	if (!url || !anonKey) return [];

	const limit = opts.limit ?? 200;
	const endpoint = `${url.replace(/\/$/, '')}/rest/v1/pm_logs?select=id,pm1,pm2_5,pm10,created_at&order=created_at.desc&limit=${limit}`;

	const f = opts.fetcher ?? fetch;
	const res = await f(endpoint, {
		headers: {
			apikey: anonKey,
			Authorization: `Bearer ${anonKey}`,
			Accept: 'application/json'
		},
		signal: opts.signal
	});

	if (!res.ok) {
		throw new Error(`Supabase request failed: ${res.status} ${res.statusText}`);
	}

	const rows = (await res.json()) as PmLog[];
	return rows;
}

export interface SubscribePmLogsInsertOptions {
	onInsert: (row: PmLog) => void;
	onStatus: (status: RealtimeStatus) => void;
}

export function subscribePmLogsInsert({
	onInsert,
	onStatus
}: SubscribePmLogsInsertOptions): () => void {
	requireBrowser();
	const supabase = getSupabaseClient();
	let channel: RealtimeChannel | null = null;

	channel = supabase
		.channel('pm_logs-inserts')
		.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pm_logs' }, (payload) => {
			onInsert(payload.new as PmLog);
		})
		.subscribe((status, err) => {
			switch (status) {
				case 'SUBSCRIBED':
					onStatus('live');
					break;
				case 'CHANNEL_ERROR':
				case 'TIMED_OUT':
					console.error('Supabase realtime error', err);
					onStatus('error');
					break;
				case 'CLOSED':
					onStatus('offline');
					break;
				default:
					onStatus('connecting');
			}
		});

	return () => {
		if (channel) {
			supabase.removeChannel(channel);
			channel = null;
		}
	};
}
