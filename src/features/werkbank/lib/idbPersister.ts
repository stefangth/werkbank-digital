import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/** The technician app's offline cache on native IndexedDB: one entry per user in one store, so a
 *  shared phone never hands one user's orders to the next. */
const DB_NAME = "werkbank-cache";
const STORE = "queries";

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

export function createIdbPersister(key: string): Persister {
  return {
    // A failed write only costs the offline copy; it never breaks the screen.
    persistClient: (client: PersistedClient) => run("readwrite", (s) => s.put(client, key)).then(() => undefined, () => undefined),
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
  await run("readwrite", (s) => s.clear());
}
