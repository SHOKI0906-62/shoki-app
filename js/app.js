// 画面の動き。データの読み書きは store.js の関数だけを使う。
import {
  initStore, isLocalMode, signIn, signOut,
  watchClients, saveClient, deleteClient,
  getSettings, saveSettings, exportAll,
} from './store.js';
import { REFERRAL_TYPES, INITIALS } from './defaults.js';

const $ = (id) => document.getElementById(id);
const state = {
  clients: [],
  settings: null,
  view: 'clients',     // いま表示している画面
  currentId: null,     // 詳細・編集中のお客さん
  form: {},            // 登録フォームでボタンで選んだ値
  unwatch: null,
};

// HTML に文字を入れるときは必ずこれを通す（名前やメモに記号が入っても画面が壊れない・悪さをしない）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fullName = (c) => [c.lastName, c.firstName].filter(Boolean).join(' ');
const calName = (c) => `${c.lastName || ''}${c.initial || ''}`;
const refLabel = (v) => REFERRAL_TYPES.find((r) => r.value === v)?.label || '';
// ひらがな・カタカナ・全角半角・大文字小文字の違いを気にせず探せるようにする
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase()
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');

function toast(text) {
  $('toastText').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($('toast').hidden = true), 2500);
}

// ---------- 起動・ログイン ----------
initStore(async (user) => {
  $('loading').hidden = true;
  if (!user) {
    state.unwatch?.();
    $('app').hidden = true;
    $('login').hidden = false;
    return;
  }
  $('login').hidden = true;
  $('app').hidden = false;
  $('localBanner').hidden = !isLocalMode;
  $('userInfo').textContent = `ログイン中：${user.email}`;
  state.settings = await getSettings();
  fillSettingsForm();
  state.unwatch = watchClients((list) => {
    state.clients = list;
    renderList();
    if (state.view === 'detail') renderDetail();
  });
}).catch((e) => {
  $('loading').textContent = '読み込みに失敗しました。電波を確認して、もう一度開いてください。';
  console.error(e);
});

$('showPw').addEventListener('change', (e) => {
  $('loginForm').pw.type = e.target.checked ? 'text' : 'password';
});
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('loginError').textContent = '';
  f.querySelector('button').disabled = true;
  try {
    await signIn(f.email.value.trim(), f.pw.value);
    f.pw.value = '';
  } catch (err) {
    const code = err.code || '';
    $('loginError').textContent =
      code.includes('too-many-requests') ? '何度も失敗したので、しばらく待ってからもう一度試してください。'
      : code.includes('network') ? '電波がつながっていません。'
      : 'メールアドレスかパスワードがちがいます。';
  } finally {
    f.querySelector('button').disabled = false;
  }
});

// ---------- 画面の切り替え ----------
function show(view) {
  state.view = view;
  const map = { clients: 'tab-clients', detail: 'view-detail', form: 'view-form', settings: 'tab-settings' };
  for (const [v, id] of Object.entries(map)) $(id).hidden = v !== view;
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === (view === 'settings' ? 'settings' : 'clients'));
  });
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
  show(state.view === 'form' && state.currentId ? 'detail' : 'clients');
}));

// ---------- 顧客一覧 ----------
function sortedClients() {
  return [...state.clients].sort((a, b) =>
    norm(a.kana || fullName(a)).localeCompare(norm(b.kana || fullName(b)), 'ja'));
}

function renderList() {
  const q = norm($('clientSearch').value);
  const list = sortedClients().filter((c) => !q || norm(fullName(c) + (c.kana || '')).includes(q));
  $('clientCount').textContent = `${state.clients.length}人${q ? `（見つかった人：${list.length}人）` : ''}`;
  $('clientList').innerHTML = list.length
    ? list.map((c) => `
      <li data-id="${esc(c.id)}">
        <div class="main">
          <div class="title">${esc(fullName(c))}${c.initial ? `<span class="tag">${esc(calName(c))}</span>` : ''}</div>
          <div class="meta">${esc([c.ageGroup, c.gender, c.job].filter(Boolean).join('・'))}</div>
        </div>
        <span class="chev">›</span>
      </li>`).join('')
    : `<li class="empty">${state.clients.length ? '見つかりません' : 'まだ登録がありません'}</li>`;
}
$('clientSearch').addEventListener('input', renderList);
$('clientList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  state.currentId = li.dataset.id;
  renderDetail();
  show('detail');
});

// ---------- 顧客の詳細 ----------
function renderDetail() {
  const c = state.clients.find((x) => x.id === state.currentId);
  if (!c) { show('clients'); return; }
  const ref = c.referral || {};
  const refBy = ref.clientId ? fullName(state.clients.find((x) => x.id === ref.clientId) || {}) : '';
  const rows = [
    ['よみがな', c.kana],
    ['カレンダー表示', c.initial ? `${calName(c)} 〇〇分` : '（頭文字が未設定）'],
    ['年代', c.ageGroup], ['性別', c.gender],
    ['身長', c.height && `${c.height} cm`], ['体重', c.weight && `${c.weight} kg`],
    ['職業', c.job],
    ['紹介元', [refLabel(ref.type), refBy, ref.name].filter(Boolean).join('：')],
    ['初回来院日', c.firstVisit],
  ];
  const introduced = state.clients.filter((x) => x.referral?.clientId === c.id);
  $('detailBody').innerHTML = `
    <h1>${esc(fullName(c))}</h1>
    <div class="card">
      <dl class="info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>
      ${c.memo ? `<div class="memo">${esc(c.memo)}</div>` : ''}
    </div>
    ${introduced.length ? `<p class="small">この人が紹介したお客さん：${introduced.map((x) => esc(fullName(x))).join('、')}</p>` : ''}`;
}
$('editClient').addEventListener('click', () => openForm(state.clients.find((x) => x.id === state.currentId)));
$('removeClient').addEventListener('click', async () => {
  const c = state.clients.find((x) => x.id === state.currentId);
  if (!c) return;
  if (!confirm(`${fullName(c)} さんを削除しますか？\n元に戻せません。`)) return;
  await deleteClient(c.id);
  state.currentId = null;
  show('clients');
  toast('削除しました');
});

// ---------- 顧客の登録・編集 ----------
function chips(el, items, key, { allowNone = true } = {}) {
  const vals = items.map((it) => (typeof it === 'string' ? { value: it, label: it } : it));
  el.innerHTML = vals.map((v) =>
    `<button type="button" class="chip${state.form[key] === v.value ? ' on' : ''}" data-v="${esc(v.value)}">${esc(v.label)}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    // もう一度押すと選択を外せる
    state.form[key] = allowNone && state.form[key] === b.dataset.v ? '' : b.dataset.v;
    el.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x.dataset.v === state.form[key]));
    if (key === 'refType') updateRefRows();
    if (key === 'initial') updateCalPreview();
  };
}

function updateRefRows() {
  const t = state.form.refType;
  $('refPersonRow').hidden = !(t === 'person' || t === 'card');
  $('refNameRow').hidden = !t;
}
function updateCalPreview() {
  const f = $('clientForm');
  $('calPreview').textContent = `${f.lastName.value.trim() || '名字'}${state.form.initial || '？'}`;
}

function openForm(c = null) {
  state.currentId = c?.id || null;
  const ref = c?.referral || {};
  state.form = { initial: c?.initial || '', ageGroup: c?.ageGroup || '', gender: c?.gender || '', job: c?.job || '', refType: ref.type || '' };
  const f = $('clientForm');
  f.reset();
  for (const k of ['lastName', 'firstName', 'kana', 'height', 'weight', 'firstVisit', 'memo']) f[k].value = c?.[k] ?? '';
  f.refName.value = ref.name || '';
  // 紹介してくれた人の候補（自分以外の登録済みのお客さん）
  f.refClientId.innerHTML = '<option value="">— 選ぶ —</option>' + sortedClients()
    .filter((x) => x.id !== c?.id)
    .map((x) => `<option value="${esc(x.id)}">${esc(fullName(x))}</option>`).join('');
  f.refClientId.value = ref.clientId || '';

  const s = state.settings;
  chips($('initialChips'), INITIALS, 'initial');
  chips($('ageChips'), s.ageGroups, 'ageGroup');
  chips($('genderChips'), s.genders, 'gender');
  chips($('jobChips'), s.jobs, 'job');
  chips($('refChips'), REFERRAL_TYPES, 'refType');
  updateRefRows();
  updateCalPreview();
  $('formTitle').textContent = c ? `${fullName(c)} さんを編集` : 'お客さんを登録';
  show('form');
}
$('newClient').addEventListener('click', () => openForm());
$('clientForm').lastName.addEventListener('input', updateCalPreview);
$('todayBtn').addEventListener('click', () => ($('clientForm').firstVisit.value = today()));

const num = (v) => {
  const n = parseFloat(String(v).normalize('NFKC'));
  return Number.isFinite(n) ? n : null;
};

$('clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const t = state.form.refType;
  const data = {
    lastName: f.lastName.value.trim(),
    firstName: f.firstName.value.trim(),
    kana: f.kana.value.trim(),
    initial: state.form.initial,
    ageGroup: state.form.ageGroup,
    gender: state.form.gender,
    height: num(f.height.value),
    weight: num(f.weight.value),
    job: state.form.job,
    referral: {
      type: t,
      clientId: t === 'person' || t === 'card' ? f.refClientId.value : '',
      name: t ? f.refName.value.trim() : '',
    },
    firstVisit: f.firstVisit.value,
    memo: f.memo.value.trim(),
  };
  if (!data.lastName) { toast('名字を入れてください'); return; }
  if (!data.initial && !confirm('下の名前の頭文字が選ばれていません。\nこのまま保存しますか？（あとで編集できます）')) return;
  const id = await saveClient(state.currentId ? { id: state.currentId, ...data } : data);
  state.currentId = state.currentId || id;
  toast('保存しました');
  renderDetail();
  show('detail');
});

// ---------- 設定 ----------
function fillSettingsForm() {
  const f = $('settingsForm');
  for (const k of ['ageGroups', 'genders', 'jobs']) f[k].value = state.settings[k].join('\n');
}
$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const next = { ...state.settings };
  for (const k of ['ageGroups', 'genders', 'jobs']) {
    const l = lines(f[k].value);
    if (l.length) next[k] = l;
  }
  try {
    await saveSettings(next);
    state.settings = next;
    fillSettingsForm();
    toast('保存しました');
  } catch {
    toast('保存できませんでした。電波を確認してください');
  }
});

$('exportBtn').addEventListener('click', async () => {
  try {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify({ app: 'shoki-app', exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shoki-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    localStorage.setItem('lastBackup', today());
    showLastBackup();
    toast('バックアップを保存しました');
  } catch {
    toast('保存できませんでした。電波を確認してください');
  }
});
function showLastBackup() {
  const d = localStorage.getItem('lastBackup');
  $('lastBackup').textContent = d ? `この端末で最後に保存した日：${d}` : 'この端末ではまだ保存していません';
}
showLastBackup();

$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('ログアウトしますか？\n次に使うときは、メールアドレスとパスワードが必要です。')) return;
  await signOut();
});

// 電波がなくてもアプリが開けるようにする
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
