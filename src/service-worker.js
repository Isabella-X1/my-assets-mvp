import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// The build replaces this manifest with revisioned HTML, JS, CSS, icons and
// PWA metadata. Private Supabase responses are never included.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// A first-time installation can protect the already-open page immediately,
// so the user does not need an extra reload before the app shell works offline.
clientsClaim();

const privatePath = /^\/(?:api|\.netlify\/functions|functions|supabase|auth\/v1|rest\/v1|storage\/v1|realtime\/v1|functions\/v1|graphql\/v1)(?:\/|$)/;

// Client-side routes use the revisioned app shell offline. Same-origin API
// paths are denied so an offline navigation can never masquerade as data.
registerRoute(new NavigationRoute(
  createHandlerBoundToURL('index.html'),
  { denylist: [privatePath] },
));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
