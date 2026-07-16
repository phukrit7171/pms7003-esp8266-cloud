import { describe, expect, it } from 'vitest';
import { aqiCategory, pm25ToAqi } from '$lib/aqi';

describe('PM2.5 AQI helpers', () => {
	it('maps EPA breakpoint edges correctly', () => {
		expect(pm25ToAqi(12)).toBe(50);
		expect(pm25ToAqi(12.1)).toBe(51);
		expect(pm25ToAqi(35.4)).toBe(100);
	});

	it('rejects invalid concentrations', () => {
		expect(pm25ToAqi(-1)).toBeNull();
		expect(pm25ToAqi(Number.NaN)).toBeNull();
	});

	it('returns the expected category metadata', () => {
		expect(aqiCategory(42)).toMatchObject({ category: 'good', label: 'Good' });
		expect(aqiCategory(175)).toMatchObject({ category: 'unhealthy', label: 'Unhealthy' });
	});
});
