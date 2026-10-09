import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/** The technician app's offline cache on native IndexedDB: one entry per user in one store, so a
 *  shared phone never hands one user's orders to the next. */
const DB_NAME = "werkbank-cache";
const STORE = "queries";
/** How long a sign out waits for the store to empty before it goes on. */
export const CLEAR_TIMEOUT_MS = 2000;

let db: Promise<IDBDatabase> | null = null;

/** One connection for every call, so writes and deletes run in the order they were made. */
function openDb(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); db = null; };
      resolve(req.result);
    };
    req.onerror = () => { db = null; reject(req.error); };
    // Another tab holding an older version: give up rather than wait for it.
    req.onblocked = () => { db = null; reject(new Error("idb_blocked")); };
  });
  return db;
}

/** Runs one request in its own transaction. Without IndexedDB (some private modes) nothing is
 *  stored and nothing restored: the app then simply has no offline copy. */
async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const conn = await openDb();
  return new Promise((resolve, reject) => {
    const req = op(conn.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const assignmentCacheKey = (userId: string) => `assignments:${userId}`;

/** On opening the app for `userId`: drops the entries of every other user (a shared phone where
 *  someone never signed out, or whose session simply expired) and any entry older than `maxAgeMs`.
 *  A failure only leaves the old entries for the next try. */
export async function pruneAssignmentCache(userId: string, maxAgeMs: number, now = Date.now()): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const keep = assignmentCacheKey(userId);
  const conn = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = conn.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const entry = cursor.value as Partial<PersistedClient> | undefined;
      const stale = typeof entry?.timestamp !== "number" || now - entry.timestamp > maxAgeMs;
      if (cursor.key !== keep || stale) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** How often a user's entry is written at most: the list refresh and the detail prefetches fire
 *  many cache events in a row, each of which would otherwise write the whole client. */
export const PERSIST_THROTTLE_MS = 1000;

/** Open throttle windows by key: the newest client waiting for the window's end, if any. A sign
 *  out cancels them all. */
const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; client: PersistedClient | null }>();

const write = (key: string, client: PersistedClient) =>
  run("readwrite", (s) => s.put(client, key)).then(() => undefined, () => undefined);

function openWindow(key: string) {
  const entry: { timer: ReturnType<typeof setTimeout>; client: PersistedClient | null } = {
    client: null,
    timer: setTimeout(() => {
      pendingWrites.delete(key);
      if (entry.client) {
        void write(key, entry.client);
        openWindow(key);
      }
    }, PERSIST_THROTTLE_MS),
  };
  pendingWrites.set(key, entry);
}

export function createIdbPersister(key: string): Persister {
  return {
    // Leading and trailing throttle: the first change is written at once, later ones in the same
    // window only as the newest client at its end. A failed write only costs the offline copy.
    persistClient: (client: PersistedClient) => {
      const pending = pendingWrites.get(key);
      if (pending) {
        pending.client = client;
        return Promise.resolve();
      }
      openWindow(key);
      return write(key, client);
    },
    restoreClient: () => run<PersistedClient>("readonly", (s) => s.get(key) as IDBRequest<PersistedClient>),
    removeClient: () => run("readwrite", (s) => s.delete(key)).then(() => undefined),
  };
}

/** Stops of the running persist subscriptions, by user id. */
const subscriptions = new Map<string, () => void>();

/** Registers the persist subscription of a user; the returned stop also unregisters it. */
export function trackPersistence(userId: string, stop: () => void): () => void {
  subscriptions.set(userId, stop);
  return () => {
    stop();
    if (subscriptions.get(userId) === stop) subscriptions.delete(userId);
  };
}

/** Sign out (spec R5): stops every running persist subscription first (so no late write brings
 *  an entry back), then empties the whole store, the signing-out user's entry and any left by
 *  users who never signed out on this phone. */
export async function clearAssignmentCache(): Promise<void> {
  for (const stop of subscriptions.values()) stop();
  subscriptions.clear();
  for (const pending of pendingWrites.values()) clearTimeout(pending.timer);
  pendingWrites.clear();
  // A store that never answers must not hold up a sign out; the next app open prunes it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("idb_timeout")), CLEAR_TIMEOUT_MS);
  });
  try {
    await Promise.race([run("readwrite", (s) => s.clear()), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
