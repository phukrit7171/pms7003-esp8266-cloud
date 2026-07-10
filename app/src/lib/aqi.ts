export type PmChannel = 'pm1' | 'pm2_5' | 'pm10';

interface AqiBreakpoint {
	cLow: number;
	cHigh: number;
	iLow: number;
	iHigh: number;
}

const PM25_BREAKPOINTS: AqiBreakpoint[] = [
	{ cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50 },
	{ cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
	{ cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
	{ cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
	{ cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
	{ cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400 },
	{ cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500 }
];

const PM10_BREAKPOINTS: AqiBreakpoint[] = [
	{ cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
	{ cLow: 55, cHigh: 154, iLow: 51, iHigh: 100 },
	{ cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
	{ cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
	{ cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
	{ cLow: 425, cHigh: 504, iLow: 301, iHigh: 400 },
	{ cLow: 505, cHigh: 604, iLow: 401, iHigh: 500 }
];

function aqiFromBreakpoints(conc: number, table: AqiBreakpoint[]): number | null {
	if (!Number.isFinite(conc) || conc < 0) return null;
	const bp = table.find((b) => conc >= b.cLow && conc <= b.cHigh);
	if (!bp) return conc > table[table.length - 1].cHigh ? 500 : null;
	const aqi = ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (conc - bp.cLow) + bp.iLow;
	return Math.round(aqi);
}

export function pm25ToAqi(pm25: number): number | null {
	return aqiFromBreakpoints(pm25, PM25_BREAKPOINTS);
}

export function pm10ToAqi(pm10: number): number | null {
	return aqiFromBreakpoints(pm10, PM10_BREAKPOINTS);
}

export type AqiCategory =
	'good' | 'moderate' | 'unhealthy-sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous';

export interface AqiInfo {
	aqi: number;
	category: AqiCategory;
	label: string;
	color: string;
}

export function aqiCategory(aqi: number): AqiInfo {
	if (aqi <= 50) return { aqi, category: 'good', label: 'Good', color: '#22c55e' };
	if (aqi <= 100) return { aqi, category: 'moderate', label: 'Moderate', color: '#eab308' };
	if (aqi <= 150)
		return {
			aqi,
			category: 'unhealthy-sensitive',
			label: 'Unhealthy for sensitive groups',
			color: '#f97316'
		};
	if (aqi <= 200) return { aqi, category: 'unhealthy', label: 'Unhealthy', color: '#ef4444' };
	if (aqi <= 300)
		return { aqi, category: 'very-unhealthy', label: 'Very unhealthy', color: '#a21caf' };
	return { aqi, category: 'hazardous', label: 'Hazardous', color: '#7f1d1d' };
}

export function pm25Info(pm25: number): AqiInfo | null {
	const aqi = pm25ToAqi(pm25);
	return aqi === null ? null : aqiCategory(aqi);
}

export function pm10Info(pm10: number): AqiInfo | null {
	const aqi = pm10ToAqi(pm10);
	return aqi === null ? null : aqiCategory(aqi);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '—';
	return value.toLocaleString(undefined, {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits
	});
}

export function formatTimestamp(value: string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString();
}

export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	const diffSec = Math.round((now.getTime() - date.getTime()) / 1000);
	if (diffSec < 5) return 'just now';
	if (diffSec < 60) return `${diffSec}s ago`;
	const diffMin = Math.round(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.round(diffHr / 24);
	return `${diffDay}d ago`;
}
