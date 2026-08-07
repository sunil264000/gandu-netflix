export const MEGA_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks
const DB_NAME = 'MegaBufferDB';
const STORE_NAME = 'chunks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putChunkToDB(key: string, data: ArrayBuffer) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearMegaBuffer() {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function checkMegaBufferExists(videoId: string, chunkIndex: number): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const key = `${videoId}_${chunkIndex}`;
    // Use count instead of get to save RAM
    const req = store.count(key);
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
  });
}

export async function getMegaBufferStats(videoId: string): Promise<{ chunks: number, bytes: number }> {
    // This is expensive if there are thousands of chunks, but OK for a rough estimate
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      
      let count = 0;
      const req = store.openCursor();
      req.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (String(cursor.key).startsWith(videoId + '_')) {
            count++;
          }
          cursor.continue();
        } else {
          resolve({ chunks: count, bytes: count * MEGA_CHUNK_SIZE });
        }
      };
      req.onerror = () => reject(req.error);
    });
}

export async function pumpMegaBuffer(videoId: string, totalBytes: number, signal: AbortSignal, onProgress: (bytes: number) => void) {
  const totalChunks = Math.ceil(totalBytes / MEGA_CHUNK_SIZE);
  let bytesBuffered = 0;

  for (let i = 0; i < totalChunks; i++) {
    if (signal.aborted) break;

    const exists = await checkMegaBufferExists(videoId, i);
    if (exists) {
      bytesBuffered += Math.min(MEGA_CHUNK_SIZE, totalBytes - (i * MEGA_CHUNK_SIZE));
      onProgress(Math.min(bytesBuffered, totalBytes));
      continue;
    }

    // Need to fetch it!
    const startByte = i * MEGA_CHUNK_SIZE;
    const endByte = Math.min((i + 1) * MEGA_CHUNK_SIZE - 1, totalBytes - 1);
    
    try {
      const resp = await fetch(`/api/public/videos/stream?id=${videoId}&bypass=true&total=${totalBytes}`, {
        headers: {
          'Range': `bytes=${startByte}-${endByte}`
        },
        signal
      });

      if (!resp.ok) {
        console.error("MegaBuffer fetch failed", resp.status);
        await new Promise(r => setTimeout(r, 2000));
        i--; // retry
        continue;
      }

      const buffer = await resp.arrayBuffer();
      await putChunkToDB(`${videoId}_${i}`, buffer);
      
      bytesBuffered += buffer.byteLength;
      onProgress(Math.min(bytesBuffered, totalBytes));

    } catch (e: any) {
      if (e.name === 'AbortError') break;
      console.error("MegaBuffer error", e);
      await new Promise(r => setTimeout(r, 2000));
      i--; // retry
    }
  }
}

