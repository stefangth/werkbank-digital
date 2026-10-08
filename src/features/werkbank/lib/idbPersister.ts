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

/** Sign out: stops persisting for the user first (so no late write brings the entry back), then
 *  deletes the user's stored cache. Other users' entries stay untouched. */
export async function clearAssignmentCache(userId: string): Promise<void> {
  subscriptions.get(userId)?.();
  subscriptions.delete(userId);
  await createIdbPersister(assignmentCacheKey(userId)).removeClient();
}
