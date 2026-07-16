import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
		PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
	}
}));

import { fetchPmLogs } from '$lib/supabase';

describe('fetchPmLogs history queries', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('fetches paginated timestamp windows from the REST endpoint', async () => {
		const responses = [
			[
				{ id: 3, pm1: 1, pm2_5: 2, pm10: 3, created_at: '2026-07-16T10:02:00.000Z' },
				{ id: 2, pm1: 1, pm2_5: 2, pm10: 3, created_at: '2026-07-16T10:01:00.000Z' }
			],
			[{ id: 1, pm1: 1, pm2_5: 2, pm10: 3, created_at: '2026-07-16T10:00:00.000Z' }]
		];
		const urls: string[] = [];
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			urls.push(String(input));
			return new Response(JSON.stringify(responses.shift() ?? []), { status: 200 });
		});

		const rows = await fetchPmLogs({
			limit: 3,
			pageSize: 2,
			from: '2026-07-16T09:00:00.000Z',
			to: '2026-07-16T11:00:00.000Z',
			fetcher
		});

		expect(rows).toHaveLength(3);
		expect(fetcher).toHaveBeenCalledTimes(2);

		const firstQuery = new URL(urls[0]).searchParams;
		const secondQuery = new URL(urls[1]).searchParams;
		expect(firstQuery.get('limit')).toBe('2');
		expect(firstQuery.get('offset')).toBe('0');
		expect(firstQuery.getAll('created_at')).toEqual([
			'gte.2026-07-16T09:00:00.000Z',
			'lt.2026-07-16T11:00:00.000Z'
		]);
		expect(secondQuery.get('offset')).toBe('2');
	});
});
