import type { PmLog } from '$lib/supabase';

export type ReadingExportFormat = 'csv' | 'json';

const COLUMNS: Array<keyof PmLog> = ['id', 'created_at', 'pm1', 'pm2_5', 'pm10'];

function csvValue(value: string | number): string {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function readingsToCsv(logs: PmLog[]): string {
	const header = COLUMNS.join(',');
	const rows = logs.map((log) => COLUMNS.map((column) => csvValue(log[column])).join(','));
	return [header, ...rows].join('\n');
}

export function downloadReadings(
	logs: PmLog[],
	format: ReadingExportFormat,
	filenamePrefix = 'pms7003-readings'
): void {
	const content = format === 'csv' ? readingsToCsv(logs) : JSON.stringify(logs, null, 2);
	const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
	const extension = format === 'csv' ? 'csv' : 'json';
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');

	link.href = url;
	link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
