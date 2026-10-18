// データの保存係。画面(app.js)はここの関数だけを使う。
// Firebase の設定があれば Firestore（iPhoneとタブレットで同期）、
// なければ「お試しモード」として localStorage（この端末だけ）に保存する。
//
// 保存する場所（Firestore）。データの鍵（firestore.rules）で本人だけ読み書きできる。
//   users/{uid}/clients/{id}       … 顧客台帳
//   users/{uid}/reservations/{id}  … 予約（ステップ2）
//   users/{uid}/visits/{id}        … 来院記録・カルテ（ステップ3）
//   users/{uid}/meta/settings      … ボタンの中身などの設定
import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
const COLLECTIONS = ['clients', 'reservations', 'visits', 'photos'];
export const isLocalMode = !firebaseConfig.apiKey;

let backend;

export async function initStore(onUser) {
  backend = isLocalMode ? localBackend() : await firebaseBackend();
  backend.onUser(onUser);
}

export const signIn = (email, pw) => backend.signIn(email, pw);
export const signOut = () => backend.signOut();
export const watchClients = (cb) => backend.watch('clients', cb);
export const saveClient = (c) => {
  const { id, ...data } = c;
  return id ? backend.update('clients', id, { ...data, updatedAt: Date.now() })
            : backend.add('clients', { ...data, createdAt: Date.now() });
};
export const deleteClient = (id) => backend.remove('clients', id);
export const watchReservations = (cb) => backend.watch('reservations', cb);
export const addReservation = (r) => backend.add('reservations', { ...r, createdAt: Date.now() });
export const updateReservation = (id, data) => backend.update('reservations', id, { ...data, updatedAt: Date.now() });
export const watchVisits = (cb) => backend.watch('visits', cb);
export const addVisit = (v) => backend.add('visits', { ...v, createdAt: Date.now() });
export const updateVisit = (id, data) => backend.update('visits', id, { ...data, updatedAt: Date.now() });
export const deleteVisit = (id) => backend.remove('visits', id);
// カルテ写真は重いので、来院記録とは別に保存し、見るときだけ読み込む
export const addPhoto = (p) => backend.add('photos', { ...p, createdAt: Date.now() });
export const getPhoto = (id) => backend.get('photos', id);
export const deletePhoto = (id) => backend.remove('photos', id);
export const updateClient = (id, data) => backend.update('clients', id, data);
export async function getSettings() {
  let saved = null;
  try { saved = await backend.getMeta('settings'); } catch { /* 電波なし → 初期値で表示 */ }
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
export const saveSettings = (s) => backend.setMeta('settings', s);
export const exportAll = () => backend.exportAll();

// ---------- お試しモード（localStorage）。本物のお客さん情報は入れない ----------
function localBackend() {
  const KEY = 'shoki-demo-v1';
  const listeners = [];
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  let db = load();
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(db));
    listeners.forEach((l) => l());
  };
  const col = (name) => (db[name] ||= {});
  const list = (name) => Object.entries(col(name)).map(([id, v]) => ({ id, ...v }));

  return {
    onUser(cb) { cb({ email: 'お試しモード', local: true }); },
    async signIn() {},
    async signOut() { localStorage.removeItem(KEY); location.reload(); },
    watch(name, cb) {
      const run = () => cb(list(name));
      listeners.push(run);
      run();
      return () => listeners.splice(listeners.indexOf(run), 1);
    },
    async add(name, data) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      col(name)[id] = data;
      save();
      return id;
    },
    async update(name, id, data) { col(name)[id] = { ...col(name)[id], ...data }; save(); },
    async remove(name, id) { delete col(name)[id]; save(); },
    async get(name, id) { const d = col(name)[id]; return d ? { id, ...d } : null; },
    async getMeta(key) { return col('meta')[key]; },
    async setMeta(key, val) { col('meta')[key] = val; save(); },
    async exportAll() { return db; },
  };
}

// ---------- Firebase（Firestore） ----------
async function firebaseBackend() {
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const auth$ = await import(FB + 'firebase-auth.js');
  const fs = await import(FB + 'firebase-firestore.js');

  const app = initializeApp(firebaseConfig);
  // ログイン状態は端末に保存（ログアウトを押すまで続く）
  const auth = auth$.initializeAuth(app, { persistence: [auth$.indexedDBLocalPersistence, auth$.browserLocalPersistence] });
  // 電波がなくても使えて、つながったら自動で同期される設定
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  let uid = null;
  const colRef = (name) => fs.collection(db, 'users', uid, name);
  const metaRef = (key) => fs.doc(db, 'users', uid, 'meta', key);

  return {
    onUser(cb) {
      auth$.onAuthStateChanged(auth, (u) => {
        uid = u ? u.uid : null;
        cb(u ? { email: u.email } : null);
      });
    },
    signIn: (email, pw) => auth$.signInWithEmailAndPassword(auth, email, pw),
    // ログアウトしたら、端末に残っているお客さんのデータ（オフライン用の控え）も消す
    async signOut() {
      await auth$.signOut(auth);
      try {
        await fs.terminate(db);
        await fs.clearIndexedDbPersistence(db);
      } catch { /* 消せなかったときも再読み込みで画面からは消える */ }
      location.reload();
    },
    watch(name, cb) {
      return fs.onSnapshot(colRef(name), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    },
    // オフラインでも待たずに進めるよう、書き込みは完了を待たない
    async add(name, data) {
      const ref = fs.doc(colRef(name));
      fs.setDoc(ref, data);
      return ref.id;
    },
    async update(name, id, data) { fs.updateDoc(fs.doc(colRef(name), id), data); },
    async remove(name, id) { fs.deleteDoc(fs.doc(colRef(name), id)); },
    async get(name, id) {
      const s = await fs.getDoc(fs.doc(colRef(name), id));
      return s.exists() ? { id: s.id, ...s.data() } : null;
    },
    async getMeta(key) {
      const s = await fs.getDoc(metaRef(key));
      return s.exists() ? s.data() : null;
    },
    async setMeta(key, val) { await fs.setDoc(metaRef(key), val); },
    async exportAll() {
      const out = {};
      for (const name of COLLECTIONS) {
        const snap = await fs.getDocs(colRef(name));
        out[name] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      }
      out.meta = { settings: await this.getMeta('settings') };
      return out;
    },
  };
}
