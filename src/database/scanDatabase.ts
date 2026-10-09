export interface StoredScan {
  id?: number;
  code: string;
  scannedAt: string;
  size?: 'S' | 'M' | 'L' | 'XL';
  foodId?: string;
  storage?: 'fridge' | 'freezer';
  storedAt?: string;
  expirationDate?: string;
}

const databaseName = 'sealed-database';
const databaseVersion = 4;
const storeName = 'scans';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = (event) => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
      } else if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        const store = request.transaction?.objectStore(storeName);
        if (!store) return;
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = () => {
          const uniqueScans = new Map<string, StoredScan>();
          for (const scan of getAllRequest.result as StoredScan[]) {
            if (!uniqueScans.has(scan.code)) uniqueScans.set(scan.code, scan);
          }
          store.clear();
          for (const scan of uniqueScans.values()) {
            store.add({ code: scan.code, scannedAt: scan.scannedAt });
          }
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Impossibile aprire il database locale del browser.'));
  });
}

export async function countScans(): Promise<number> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).count();
    request.onsuccess = () => {
      database.close();
      resolve(request.result);
    };
    request.onerror = () => {
      database.close();
      reject(new Error('Impossibile leggere il database locale.'));
    };
  });
}

export async function getScans(): Promise<StoredScan[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => {
      database.close();
      resolve((request.result as StoredScan[]).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt)));
    };
    request.onerror = () => {
      database.close();
      reject(new Error('Impossibile leggere i contenitori dal database locale.'));
    };
  });
}

export async function updateScan(id: number, changes: Partial<StoredScan>): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const request = transaction.objectStore(storeName).get(id);
    request.onsuccess = () => {
      const scan = request.result as StoredScan | undefined;
      if (scan) {
        transaction.objectStore(storeName).put({ ...scan, ...changes });
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error('Impossibile aggiornare il contenitore.'));
    };
  });
}

export async function clearScans(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error('Impossibile svuotare il database locale.'));
    };
  });
}

export async function saveScan(code: string): Promise<{ count: number; added: boolean }> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const getAllRequest = store.getAll();
    let added = false;
    getAllRequest.onsuccess = () => {
      const alreadyStored = (getAllRequest.result as StoredScan[]).some((scan) => scan.code === code);
      if (!alreadyStored) {
        store.add({ code, scannedAt: new Date().toISOString() } satisfies StoredScan);
        added = true;
      }
    };
    transaction.oncomplete = () => {
      database.close();
      void countScans().then((count) => resolve({ count, added }), reject);
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error('Impossibile salvare il codice nel database locale.'));
    };
  });
}
