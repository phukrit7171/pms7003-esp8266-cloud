import { fetchPmLogs, hasSupabaseConfig, type PmLog } from '$lib/supabase';
import type { PageServerLoad } from './$types';

export interface DashboardData {
	logs: PmLog[];
	configured: boolean;
	error: string | null;
	fetchedAt: string;
}

export const load: PageServerLoad = async ({ fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, max-age=15' });

	const data: DashboardData = {
		logs: [],
		configured: hasSupabaseConfig(),
		error: null,
		fetchedAt: new Date().toISOString()
	};

	if (!data.configured) {
		data.error =
			'Supabase is not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY in your environment.';
		return data;
	}

	try {
		data.logs = await fetchPmLogs({ limit: 500, fetcher: fetch });
	} catch (err) {
		data.error = err instanceof Error ? err.message : 'Failed to load readings from Supabase.';
	}

	return data;
};
