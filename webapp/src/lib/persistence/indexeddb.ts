import type { GraphDocument } from '../core/schema';
import type { GraphRepository } from './repository';

const DB_NAME = 'stars-local';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const SNAPSHOT_KEY = 'graph';

export class IndexedDbGraphRepository implements GraphRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    });

    return this.dbPromise;
  }

  async load(): Promise<GraphDocument | null> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(SNAPSHOT_KEY);

      request.onsuccess = () => resolve((request.result as GraphDocument | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'));
    });
  }

  async save(snapshot: GraphDocument): Promise<void> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(snapshot, SNAPSHOT_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'));
    });
  }

  async reset(): Promise<void> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SNAPSHOT_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 重置失败'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 重置中止'));
    });
  }
}