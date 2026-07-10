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
