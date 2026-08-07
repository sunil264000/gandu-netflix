const CACHE_NAME = 'gandu-megabuffer-v2';
const DB_NAME = 'MegaBufferDB';
const STORE_NAME = 'chunks';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getChunkFromDB(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept video stream requests
  if (url.pathname.startsWith('/api/public/videos/stream')) {
    // If bypass is set, this is the background pre-loader fetching data to cache it!
    if (url.searchParams.get('bypass') === 'true') {
      return;
    }

    const rangeHeader = event.request.headers.get('Range');
    const videoId = url.searchParams.get('id');
    const totalBytes = Number(url.searchParams.get('total') || 0);

    if (rangeHeader && videoId) {
      event.respondWith(
        (async () => {
          try {
            // Parse Range: bytes=start-end
            const match = rangeHeader.match(/bytes=(\d+)-(.*)/);
            if (!match) return fetch(event.request);

            const startByte = parseInt(match[1], 10);
            
            // Calculate which 5MB chunk this belongs to
            const chunkIndex = Math.floor(startByte / CHUNK_SIZE);
            const key = `${videoId}_${chunkIndex}`;

            const db = await openDB();
            const chunkData = await getChunkFromDB(db, key);

            if (chunkData) {
              // We have the chunk! 
              // We need to slice the exact bytes requested.
              const chunkStartByte = chunkIndex * CHUNK_SIZE;
              const offsetInChunk = startByte - chunkStartByte;
              
              // We'll serve from startByte to the end of this chunk
              // The browser will ask for the next chunk automatically when it finishes this one.
              const bytesToServe = chunkData.slice(offsetInChunk);
              const endByte = startByte + bytesToServe.byteLength - 1;

              const headers = new Headers();
              headers.set('Content-Type', 'video/mp4');
              headers.set('Content-Length', bytesToServe.byteLength.toString());
              headers.set('Content-Range', `bytes ${startByte}-${endByte}/${totalBytes || '*'}`);
              headers.set('Accept-Ranges', 'bytes');
              
              return new Response(bytesToServe, {
                status: 206,
                headers: headers
              });
            }
          } catch (e) {
            console.error('[MegaBuffer SW] Error', e);
          }
          
          // Fallback to network
          return fetch(event.request);
        })()
      );
    }
  }
});
