const DB_NAME = 'huashi-chats-v1';
const STORE = 'chats';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(result);
    });
  } finally { db.close(); }
}

export const chatStore = {
  async list() { const chats = await transact('readonly', store => store.getAll()); return chats.sort((a,b) => b.updatedAt - a.updatedAt); },
  async save(chat) { await transact('readwrite', store => store.put(chat)); },
  async remove(id) { await transact('readwrite', store => store.delete(id)); }
};
