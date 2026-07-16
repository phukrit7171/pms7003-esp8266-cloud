/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;
const CACHE = `pms7003-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then(async (cache) => {
			await cache.addAll(ASSETS);
			await sw.skipWaiting();
		})
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(event.request);

			try {
				const response = await fetch(event.request);
				if (
					response instanceof Response &&
					response.ok &&
					!response.headers.get('cache-control')?.includes('no-store')
				) {
					await cache.put(event.request, response.clone());
				}
				return response;
			} catch {
				if (cached) return cached;
				throw new Error('Network unavailable and no cached response exists.');
			}
		})()
	);
});
