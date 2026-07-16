import { describe, expect, it } from 'vitest';
import { readingsToCsv } from '$lib/export';

describe('reading exports', () => {
	it('creates a stable CSV header and row order', () => {
		expect(
			readingsToCsv([
				{ id: 7, created_at: '2026-07-16T10:00:00.000Z', pm1: 1, pm2_5: 2.5, pm10: 4 }
			])
		).toBe('id,created_at,pm1,pm2_5,pm10\n7,2026-07-16T10:00:00.000Z,1,2.5,4');
	});

	it('escapes values containing commas or quotes', () => {
		const csv = readingsToCsv([{ id: 1, created_at: 'a,"timestamp"', pm1: 1, pm2_5: 2, pm10: 3 }]);

		expect(csv).toContain('1,"a,""timestamp""",1,2,3');
	});
});
