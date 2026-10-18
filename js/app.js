// 画面の動き。データの読み書きは store.js の関数だけを使う。
import {
  initStore, isLocalMode, signIn, signOut,
  watchClients, saveClient, deleteClient,
  watchReservations, addReservation, updateReservation,
  watchVisits, addVisit, updateVisit, deleteVisit, addPhoto, getPhoto, deletePhoto, updateClient,
  getSettings, saveSettings, exportAll,
} from './store.js';
import { eventTitle, toIso, isConfigured, callCalendar, makeSecret } from './calendar.js';
import { POINTS, MERIDIANS, pointByCode } from './points.js';
import { REFERRAL_TYPES, INITIALS } from './defaults.js';

const $ = (id) => document.getElementById(id);
const state = {
  clients: [],
  settings: null,
  resv: [],
  visits: [],
  vf: {},              // カルテ入力中の値
  visitId: null,       // 詳細を見ている来院記録
  visitFrom: 'detail', // カルテ入力を開いた画面（もどる先）
  view: 'resv',        // いま表示している画面
  day: null,           // 予約一覧で見ている日
  rf: {},              // 予約フォームで選んだ値
  resvId: null,        // 詳細を見ている予約
  fromResv: false,     // 予約フォームから「新しいお客さん」を登録中
  currentId: null,     // 詳細・編集中のお客さん
  form: {},            // 登録フォームでボタンで選んだ値
  unwatch: [],
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
    state.unwatch.forEach((u) => u());
    state.unwatch = [];
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
  state.day = today();
  state.unwatch.push(watchClients((list) => {
    state.clients = list;
    renderList();
    if (state.view === 'detail') renderDetail();
    renderResv();
  }));
  state.unwatch.push(watchReservations((list) => {
    state.resv = list;
    renderResv();
    if (state.view === 'resvdetail') renderResvDetail();
    if (state.view === 'resvform') renderResvForm();
    if (state.view === 'detail') renderDetail();
    retryCalendar();
  }));
  state.unwatch.push(watchVisits((list) => {
    state.visits = list;
    if (state.view === 'detail') renderDetail();
    if (state.view === 'visitdetail') renderVisitDetail();
    if (state.view === 'resvdetail') renderResvDetail();
  }));
  show('resv');
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
    const code = err.code || err.name || 'unknown';
    const msg =
      code.includes('too-many-requests') ? '何度も失敗したので、しばらく待ってからもう一度試してください。'
      : code.includes('network') ? '電波がつながっていないか、通信がブロックされています。'
      : code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')
        ? 'メールアドレスかパスワードがちがいます。'
        : 'ログインできませんでした。';
    // 原因を調べられるように、エラーの種類（英語）も小さく出す
    $('loginError').textContent = `${msg}（${code}）`;
    console.error(err);
  } finally {
    f.querySelector('button').disabled = false;
  }
});

// ---------- 画面の切り替え ----------
const VIEWS = {
  resv: ['tab-resv', 'resv'], resvform: ['view-resvform', 'resv'], resvdetail: ['view-resvdetail', 'resv'],
  clients: ['tab-clients', 'clients'], detail: ['view-detail', 'clients'], form: ['view-form', 'clients'],
  settings: ['tab-settings', 'settings'],
  visitform: ['view-visitform', 'clients'], visitdetail: ['view-visitdetail', 'clients'],
};
function show(view) {
  state.view = view;
  for (const [v, [id]] of Object.entries(VIEWS)) $(id).hidden = v !== view;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === VIEWS[view][1]));
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  state.fromResv = false;
  show(b.dataset.tab);
}));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
  const v = state.view;
  if (v === 'form' && state.fromResv) { state.fromResv = false; show('resvform'); }
  else if (v === 'form') show(state.currentId ? 'detail' : 'clients');
  else if (v === 'resvform') show(state.rf.editId ? 'resvdetail' : 'resv');
  else if (v === 'resvdetail') show('resv');
  else if (v === 'visitform') show(state.visitFrom);
  else if (v === 'visitdetail') show('detail');
  else show('clients');
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
    ${introduced.length ? `<p class="small">この人が紹介したお客さん：${introduced.map((x) => esc(fullName(x))).join('、')}</p>` : ''}
    ${upcomingOf(c.id)}`;
  renderVisitList(c.id);
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
$('newClient').addEventListener('click', () => { state.fromResv = false; openForm(); });
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
  if (state.fromResv) {
    state.fromResv = false;
    state.rf.clientId = state.currentId;
    $('rfClientSearch').value = '';
    renderResvForm();
    show('resvform');
    return;
  }
  renderDetail();
  show('detail');
});

// ---------- 予約 ----------
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (ymd) => {
  const d = new Date(`${ymd}T12:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
};
const relLabel = (ymd) => ({ [today()]: '今日', [addDays(today(), 1)]: '明日', [addDays(today(), 2)]: 'あさって' }[ymd] || '');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const clientOf = (id) => state.clients.find((c) => c.id === id);
const priceOf = (min) => state.settings.courses.find((c) => c.min === min)?.price ?? 0;
const active = (r) => r.status !== 'cancelled';
const SYNC = { ok: ['📅', 'カレンダー反映済み'], pending: ['⏳', 'カレンダーに送信中'], error: ['⚠️', 'カレンダー未反映'], off: ['', ''] };

function renderResv() {
  if (!state.day || !state.settings) return;
  // 日付のボタン（今日から2週間）
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i));
  if (!days.includes(state.day)) days.unshift(state.day);
  $('dayStrip').innerHTML = days.map((d) => {
    const n = state.resv.filter((r) => r.date === d && active(r)).length;
    return `<button class="day${d === state.day ? ' on' : ''}" data-d="${d}">
      <span class="rel">${relLabel(d) || '&nbsp;'}</span><span>${dayLabel(d)}</span>${n ? `<span class="badge">${n}</span>` : ''}</button>`;
  }).join('');
  $('dayTitle').textContent = `${relLabel(state.day) ? relLabel(state.day) + ' ' : ''}${dayLabel(state.day)} の予約`;
  $('dayPicker').value = state.day;
  const list = state.resv.filter((r) => r.date === state.day && active(r)).sort((a, b) => a.start.localeCompare(b.start));
  const cancelled = state.resv.filter((r) => r.date === state.day && !active(r)).length;
  $('resvList').innerHTML = (list.length ? list.map((r) => {
    const c = clientOf(r.clientId);
    const [icon, tip] = SYNC[r.calSync] || SYNC.off;
    return `<li data-rid="${esc(r.id)}" class="${r.status === 'done' ? 'done' : ''}">
      <div class="time">${esc(r.start)}<small>〜${esc(toTime(toMin(r.start) + r.course))}</small></div>
      <div class="main">
        <div class="title">${esc(c ? fullName(c) : '（削除されたお客さん）')}</div>
        <div class="meta">${r.course}分${r.status === 'done' ? '・<b class="ok">来院済み</b>' : ''}</div>
      </div>
      <span class="sync" title="${tip}">${icon}</span><span class="chev">›</span>
    </li>`;
  }).join('') : '<li class="empty">予約はありません</li>')
    + (cancelled ? `<li class="empty small">キャンセル ${cancelled}件</li>` : '');
  $('calWarn').hidden = isConfigured(state.settings);
}
$('dayStrip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]');
  if (b) { state.day = b.dataset.d; renderResv(); }
});
$('dayPicker').addEventListener('change', (e) => { if (e.target.value) { state.day = e.target.value; renderResv(); } });
$('resvList').addEventListener('click', (e) => {
  const li = e.target.closest('[data-rid]');
  if (!li) return;
  state.resvId = li.dataset.rid;
  renderResvDetail();
  show('resvdetail');
});

// その人のこれからの予約（お客さんの詳細画面に出す）
function upcomingOf(clientId) {
  const list = state.resv.filter((r) => r.clientId === clientId && r.status === 'booked' && r.date >= today())
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (!list.length) return '';
  return `<h2>これからの予約</h2><ul class="list">${list.map((r) =>
    `<li><div class="main"><div class="title">${esc(dayLabel(r.date))} ${esc(r.start)}</div><div class="meta">${r.course}分</div></div></li>`).join('')}</ul>`;
}

// ----- 予約フォーム -----
function openResvForm(r = null) {
  state.rf = r
    ? { editId: r.id, date: r.date, time: r.start, clientId: r.clientId, course: r.course }
    : { date: state.day || today(), time: '', clientId: '', course: 0 };
  $('rfClientSearch').value = '';
  $('resvFormTitle').textContent = r ? '予約を変更' : '予約を入れる';
  $('rfSave').textContent = r ? 'この内容に変更する' : 'この内容で予約する';
  renderResvForm();
  show('resvform');
}
$('newResv').addEventListener('click', () => openResvForm());

// ほかの予約と時間が重なっているか
function overlaps(date, start, course, exceptId) {
  const s = toMin(start), e = s + course;
  return state.resv.filter((r) => r.id !== exceptId && r.date === date && active(r)).find((r) => {
    const rs = toMin(r.start), re = rs + r.course;
    return s < re && rs < e;
  });
}

function renderResvForm() {
  const rf = state.rf;
  const st = state.settings;
  // ① 日付
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i));
  if (rf.date && !days.includes(rf.date)) days.unshift(rf.date);
  $('rfDays').innerHTML = days.map((d) =>
    `<button type="button" class="chip day-chip${d === rf.date ? ' on' : ''}" data-d="${d}">${relLabel(d) ? `<b>${relLabel(d)}</b> ` : ''}${dayLabel(d)}</button>`).join('');
  $('rfDate').value = rf.date || '';
  // ② 時間（ほかの予約がある時間は灰色）
  const times = [];
  for (let m = toMin(st.openTime); m <= toMin(st.closeTime); m += Number(st.slotStep) || 30) times.push(toTime(m));
  if (rf.time && !times.includes(rf.time)) times.push(rf.time);
  times.sort();
  $('rfTimes').innerHTML = times.map((t) => {
    const busy = rf.date && overlaps(rf.date, t, Number(st.slotStep) || 30, rf.editId);
    return `<button type="button" class="chip${t === rf.time ? ' on' : ''}${busy ? ' busy' : ''}" data-t="${t}">${t}</button>`;
  }).join('');
  // ③ お客さん
  const q = norm($('rfClientSearch').value);
  let list = sortedClients().filter((c) => !q || norm(fullName(c) + (c.kana || '')).includes(q));
  const sel = clientOf(rf.clientId);
  if (sel && !list.includes(sel)) list.unshift(sel);
  list = list.slice(0, 40);
  $('rfClients').innerHTML = list.length
    ? list.map((c) => `<button type="button" class="chip${c.id === rf.clientId ? ' on' : ''}" data-c="${esc(c.id)}">${esc(fullName(c))}</button>`).join('')
    : `<p class="muted small">${state.clients.length ? '見つかりません' : 'まだお客さんが登録されていません'}</p>`;
  // ④ コース
  $('rfCourses').innerHTML = st.courses.map((c) =>
    `<button type="button" class="chip${c.min === rf.course ? ' on' : ''}" data-m="${c.min}"><b>${c.min}分</b><small>${c.price.toLocaleString()}円</small></button>`).join('');
  // まとめ
  const parts = [];
  if (rf.date) parts.push(dayLabel(rf.date));
  if (rf.time) parts.push(rf.course ? `${rf.time}〜${toTime(toMin(rf.time) + rf.course)}` : rf.time);
  if (sel) parts.push(`${fullName(sel)}さん`);
  if (rf.course) parts.push(`${rf.course}分`);
  const ready = rf.date && rf.time && sel && rf.course;
  $('rfSummary').innerHTML = parts.length
    ? `${esc(parts.join('　'))}${ready ? `<br><span class="muted small">カレンダーには「${esc(eventTitle(sel, rf.course))}」と入ります${sel.initial ? '' : '（頭文字が未設定です）'}</span>` : ''}`
    : '<span class="muted">① 日付 → ② 時間 → ③ お客さん → ④ コース の順にタップ</span>';
  $('rfSave').disabled = !ready;
}
$('rfDays').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]');
  if (b) { state.rf.date = b.dataset.d; renderResvForm(); }
});
$('rfDate').addEventListener('change', (e) => { if (e.target.value) { state.rf.date = e.target.value; renderResvForm(); } });
$('rfTimes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]');
  if (b) { state.rf.time = b.dataset.t; renderResvForm(); }
});
$('rfClients').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (b) { state.rf.clientId = b.dataset.c; renderResvForm(); }
});
$('rfClientSearch').addEventListener('input', renderResvForm);
$('rfCourses').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (b) { state.rf.course = Number(b.dataset.m); renderResvForm(); }
});
$('rfNewClient').addEventListener('click', () => {
  state.fromResv = true;
  openForm();
  const q = $('rfClientSearch').value.trim();
  if (q) $('clientForm').lastName.value = q;
});

$('rfSave').addEventListener('click', async () => {
  const rf = state.rf;
  const c = clientOf(rf.clientId);
  if (!(rf.date && rf.time && c && rf.course)) return;
  const hit = overlaps(rf.date, rf.time, rf.course, rf.editId);
  if (hit) {
    const hc = clientOf(hit.clientId);
    if (!confirm(`${hit.start}〜 ${hc ? fullName(hc) : ''}さんの予約と時間が重なっています。\nこのまま保存しますか？`)) return;
  }
  const data = { date: rf.date, start: rf.time, clientId: rf.clientId, course: rf.course };
  const old = state.resv.find((r) => r.id === rf.editId);
  let id = rf.editId;
  let full;
  if (id) {
    await updateReservation(id, data);
    full = { ...old, ...data, id };
  } else {
    // 「送信中」で作る（もう1台の端末が同時に送らないように）
    const sync = isConfigured(state.settings) ? { calSync: 'pending', pendingAt: Date.now() } : { calSync: 'off' };
    full = { ...data, status: 'booked', calEventId: '', ...sync };
    id = await addReservation(full);
    full.id = id;
  }
  state.day = rf.date;
  state.resvId = id;
  toast(rf.editId ? '変更しました' : '予約を入れました');
  show('resv');
  renderResv();
  syncCalendar(full);
});

// ----- 予約の詳細 -----
function renderResvDetail() {
  const r = state.resv.find((x) => x.id === state.resvId);
  if (!r) { show('resv'); return; }
  const c = clientOf(r.clientId);
  const statusLabel = { booked: '予約中', done: '来院済み', cancelled: 'キャンセル' }[r.status] || '';
  const [icon, tip] = SYNC[r.calSync] || SYNC.off;
  const calText = !isConfigured(state.settings) ? 'カレンダー連携は未設定'
    : r.status === 'cancelled' ? (r.calSync === 'ok' ? 'カレンダーから削除済み' : `${icon} カレンダーから未削除`)
    : `${icon} ${tip}`;
  $('rdBody').innerHTML = `
    <h1>${esc(dayLabel(r.date))} ${esc(r.start)}〜${esc(toTime(toMin(r.start) + r.course))}</h1>
    <div class="card">
      <dl class="info">
        <dt>お客さん</dt><dd>${esc(c ? fullName(c) : '（削除されたお客さん）')}</dd>
        <dt>コース</dt><dd>${r.course}分（${priceOf(r.course).toLocaleString()}円）</dd>
        <dt>状態</dt><dd>${statusLabel}</dd>
        <dt>カレンダー</dt><dd>${esc(calText)}</dd>
        <dt>予定の名前</dt><dd>${esc(eventTitle(c, r.course))}</dd>
      </dl>
    </div>`;
  const v = state.visits.find((x) => x.reservationId === r.id);
  $('rdDone').hidden = r.status === 'cancelled';
  $('rdDone').textContent = v ? '📋 カルテを見る' : '✓ 来院済み → カルテを書く';
  $('rdEdit').hidden = r.status !== 'booked';
  $('rdCancel').hidden = r.status !== 'booked';
  $('rdUndo').hidden = r.status === 'booked';
  $('rdRetry').hidden = !(isConfigured(state.settings) && r.calSync === 'error');
}
const curResv = () => state.resv.find((x) => x.id === state.resvId);
$('rdEdit').addEventListener('click', () => { const r = curResv(); if (r) openResvForm(r); });
$('rdCancel').addEventListener('click', async () => {
  const r = curResv();
  if (!r || !confirm('この予約をキャンセルしますか？\nカレンダーの予定も消えます。')) return;
  await updateReservation(r.id, { status: 'cancelled' });
  toast('キャンセルしました');
  syncCalendar({ ...r, status: 'cancelled' });
  show('resv');
});
$('rdDone').addEventListener('click', () => {
  const r = curResv();
  if (!r) return;
  const v = state.visits.find((x) => x.reservationId === r.id);
  if (v) { openVisitDetail(v.id); return; }
  state.visitFrom = 'resvdetail';
  openVisitForm({ date: r.date, clientId: r.clientId, course: r.course, reservationId: r.id });
});
$('rdUndo').addEventListener('click', async () => {
  const r = curResv();
  if (!r) return;
  await updateReservation(r.id, { status: 'booked' });
  toast('予約中にもどしました');
  if (r.status === 'cancelled') syncCalendar({ ...r, status: 'booked', calEventId: '' });
});
$('rdRetry').addEventListener('click', () => { const r = curResv(); if (r) syncCalendar(r); });

// ----- カレンダーに反映する -----
const inFlight = new Set();
async function syncCalendar(r) {
  if (!isConfigured(state.settings) || inFlight.has(r.id)) return;
  inFlight.add(r.id);
  try {
    if (r.status === 'cancelled') {
      if (r.calEventId) {
        await updateReservation(r.id, { calSync: 'pending', pendingAt: Date.now() });
        await callCalendar(state.settings, { action: 'delete', eventId: r.calEventId });
      }
      await updateReservation(r.id, { calSync: 'ok', calEventId: '' });
      return;
    }
    await updateReservation(r.id, { calSync: 'pending', pendingAt: Date.now() });
    const res = await callCalendar(state.settings, {
      action: 'upsert',
      eventId: r.calEventId || '',
      title: eventTitle(clientOf(r.clientId), r.course),
      start: toIso(r.date, r.start),
      end: toIso(r.date, r.start, r.course),
    });
    await updateReservation(r.id, { calSync: 'ok', calEventId: res.eventId });
  } catch (err) {
    console.error(err);
    await updateReservation(r.id, { calSync: 'error' });
  } finally {
    inFlight.delete(r.id);
  }
}

// 電波がなかったなどで反映できなかった予約を、あとで送り直す
function retryCalendar() {
  if (!isConfigured(state.settings) || !navigator.onLine) return;
  for (const r of state.resv) {
    if (r.date < addDays(today(), -1) && r.status !== 'cancelled') continue; // 終わった予約は送らない
    const stale = r.calSync === 'pending' && Date.now() - (r.pendingAt || 0) > 60000;
    if (r.calSync === 'error' || r.calSync === 'off' || stale) {
      if (r.status === 'cancelled' && !r.calEventId) continue;
      if (r.status === 'done' && r.calEventId) continue;
      syncCalendar(r);
    }
  }
}
window.addEventListener('online', retryCalendar);

// ---------- 来院記録（カルテ） ----------
const sideLabel = (side) => ({ L: 'L', R: 'R', LR: 'L・R' }[side] || '');
const complaintText = (list = []) => list.map((c) => (c.side ? `${c.name}（${sideLabel(c.side)}）` : c.name)).join('、');
const pointText = (codes = []) => codes.map((cd) => `${cd} ${pointByCode[cd]?.name || ''}`.trim()).join('、');
const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const visitsOf = (clientId) => state.visits.filter((v) => v.clientId === clientId)
  .sort((a, b) => (b.date + (b.createdAt || 0)).localeCompare(a.date + (a.createdAt || 0)));

function renderVisitList(clientId) {
  const list = visitsOf(clientId);
  $('visitList').innerHTML = list.length ? list.map((v) => `
    <li data-vid="${esc(v.id)}">
      <div class="main">
        <div class="title">${esc(dayLabel(v.date))}　${v.course}分　${v.freeInvite ? '<span class="tag">無料招待</span>' : esc(yen(v.amount))}${v.photoIds?.length ? ' 📷' : ''}</div>
        <div class="meta">${esc(complaintText(v.complaints) || v.complaintText || '（主訴なし）')}${v.points?.length ? `・経穴${v.points.length}` : ''}</div>
      </div><span class="chev">›</span>
    </li>`).join('') : '<li class="empty">まだ来院記録がありません</li>';
}
$('visitList').addEventListener('click', (e) => {
  const li = e.target.closest('[data-vid]');
  if (li) openVisitDetail(li.dataset.vid);
});
$('newVisit').addEventListener('click', () => {
  state.visitFrom = 'detail';
  const last = visitsOf(state.currentId)[0];
  openVisitForm({ date: today(), clientId: state.currentId, course: last?.course || 60 });
});

// ----- カルテ入力 -----
function openVisitForm(init, existing = null) {
  const c = clientOf(init.clientId || existing?.clientId);
  const firstTime = !visitsOf(c?.id).some((v) => v.id !== existing?.id);
  const free = existing ? existing.freeInvite : firstTime && c?.referral?.type === 'card';
  const course = existing?.course || init.course || 60;
  state.vf = {
    id: existing?.id || null,
    clientId: c?.id,
    reservationId: existing?.reservationId ?? init.reservationId ?? '',
    date: existing?.date || init.date || today(),
    course,
    complaints: (existing?.complaints || []).map((x) => ({ name: x.name, L: x.side?.includes('L'), R: x.side?.includes('R') })),
    complaintText: existing?.complaintText || '',
    points: [...(existing?.points || [])],
    memo: existing?.memo || '',
    payment: free ? '無料招待' : '現金',
    amount: existing ? existing.amount : (free ? 0 : priceOf(course)),
    photoIds: [...(existing?.photoIds || [])],
    newPhotos: [],
    removedPhotos: [],
    meridian: '',
  };
  $('vfTitle').textContent = existing ? 'カルテを編集' : 'カルテを書く';
  $('vfWho').textContent = c ? `${fullName(c)} さん` : '';
  $('vfDate').value = state.vf.date;
  $('vfComplaintText').value = state.vf.complaintText;
  $('vfMemo').value = state.vf.memo;
  $('vfPointSearch').value = '';
  renderVisitForm();
  renderVfPhotos();
  show('visitform');
}

function renderVisitForm() {
  const vf = state.vf;
  const st = state.settings;
  $('vfCourses').innerHTML = st.courses.map((c) =>
    `<button type="button" class="chip${c.min === vf.course ? ' on' : ''}" data-m="${c.min}">${c.min}分</button>`).join('');
  // 主訴
  const names = [...st.complaints, ...vf.complaints.map((x) => x.name).filter((n) => !st.complaints.includes(n))];
  const selected = new Set(vf.complaints.map((x) => x.name));
  $('vfComplaints').innerHTML = names.map((n) =>
    `<button type="button" class="chip${selected.has(n) ? ' on' : ''}" data-cp="${esc(n)}">${esc(n)}</button>`).join('');
  $('vfSides').innerHTML = vf.complaints.map((x, i) => `
    <div class="side-row"><span>${esc(x.name)}</span>
      <button type="button" class="chip lr${x.L ? ' on' : ''}" data-side="L" data-i="${i}">L</button>
      <button type="button" class="chip lr${x.R ? ' on' : ''}" data-side="R" data-i="${i}">R</button>
    </div>`).join('');
  // 経穴
  $('vfPointCount').textContent = vf.points.length ? `${vf.points.length}穴` : '';
  $('vfPointsSel').innerHTML = vf.points.map((cd) =>
    `<button type="button" class="chip on" data-pt="${esc(cd)}">${esc(cd)} ${esc(pointByCode[cd]?.name || '')} ✕</button>`).join('');
  $('vfMeridians').innerHTML = `<button type="button" class="chip small${vf.meridian === '' ? ' on' : ''}" data-mer="">よく使う</button>`
    + MERIDIANS.map((m) => `<button type="button" class="chip small${vf.meridian === m.code ? ' on' : ''}" data-mer="${m.code}" title="${m.name}">${m.code}</button>`).join('');
  renderPointList();
  // 支払い
  $('vfPay').innerHTML = ['現金', '無料招待'].map((p) =>
    `<button type="button" class="chip${vf.payment === p ? ' on' : ''}" data-pay="${p}">${p}</button>`).join('');
  $('vfAmountRow').hidden = vf.payment === '無料招待';
  $('vfAmount').value = vf.amount;
}

function renderPointList() {
  const vf = state.vf;
  const q = norm($('vfPointSearch').value);
  let list;
  if (q) {
    list = POINTS.filter((p) => norm(p.code).startsWith(q) || norm(p.name).includes(q) || norm(p.yomi).includes(q)).slice(0, 40);
  } else if (vf.meridian) {
    list = POINTS.filter((p) => p.meridian === vf.meridian);
  } else {
    // よく使う経穴（これまでのカルテで使った回数が多い順）
    const count = {};
    state.visits.forEach((v) => (v.points || []).forEach((cd) => { count[cd] = (count[cd] || 0) + 1; }));
    list = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([cd]) => pointByCode[cd]).filter(Boolean);
  }
  const sel = new Set(vf.points);
  $('vfPointList').innerHTML = list.length
    ? list.map((p) => `<button type="button" class="chip${sel.has(p.code) ? ' on' : ''}" data-pt="${p.code}"><b>${p.code}</b> ${esc(p.name)}<small>${esc(p.yomi)}</small></button>`).join('')
    : `<p class="muted small">${q ? '見つかりません' : 'まだ使った経穴がありません。上の検索か、経絡（LU・LI…）から選んでください'}</p>`;
}

$('vfCourses').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  state.vf.course = Number(b.dataset.m);
  if (state.vf.payment === '現金') state.vf.amount = priceOf(state.vf.course);
  renderVisitForm();
});
$('vfComplaints').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cp]');
  if (!b) return;
  const vf = state.vf;
  const i = vf.complaints.findIndex((x) => x.name === b.dataset.cp);
  if (i >= 0) vf.complaints.splice(i, 1); else vf.complaints.push({ name: b.dataset.cp, L: false, R: false });
  renderVisitForm();
});
$('vfSides').addEventListener('click', (e) => {
  const b = e.target.closest('[data-side]');
  if (!b) return;
  const x = state.vf.complaints[Number(b.dataset.i)];
  x[b.dataset.side] = !x[b.dataset.side];
  renderVisitForm();
});
const togglePoint = (e) => {
  const b = e.target.closest('[data-pt]');
  if (!b) return;
  const pts = state.vf.points;
  const i = pts.indexOf(b.dataset.pt);
  if (i >= 0) pts.splice(i, 1); else pts.push(b.dataset.pt);
  renderVisitForm();
};
$('vfPointsSel').addEventListener('click', togglePoint);
$('vfPointList').addEventListener('click', togglePoint);
$('vfPointSearch').addEventListener('input', renderPointList);
$('vfMeridians').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mer]');
  if (!b) return;
  state.vf.meridian = b.dataset.mer;
  $('vfPointSearch').value = '';
  renderVisitForm();
});
$('vfPay').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pay]');
  if (!b) return;
  state.vf.payment = b.dataset.pay;
  state.vf.amount = b.dataset.pay === '無料招待' ? 0 : priceOf(state.vf.course);
  renderVisitForm();
});

// ----- カルテ写真（小さくしてから保存） -----
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 1600;
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r);
        cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let q = 0.75;
        let data = cv.toDataURL('image/jpeg', q);
        while (data.length > 400000 && q > 0.35) { q -= 0.1; data = cv.toDataURL('image/jpeg', q); }
        resolve(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$('vfPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    state.vf.newPhotos.push(await shrinkImage(file));
    renderVfPhotos();
  } catch {
    toast('写真を読み込めませんでした');
  }
});
async function renderVfPhotos() {
  const vf = state.vf;
  const olds = await Promise.all(vf.photoIds.map(async (id) => ({ id, data: (await getPhoto(id).catch(() => null))?.data })));
  $('vfPhotos').innerHTML = [
    ...olds.map((p) => `<div class="photo">${p.data ? `<img src="${p.data}" alt="カルテ写真">` : '<span class="muted small">読み込み中…</span>'}<button type="button" data-rm-old="${esc(p.id)}">✕</button></div>`),
    ...vf.newPhotos.map((d, i) => `<div class="photo"><img src="${d}" alt="カルテ写真"><button type="button" data-rm-new="${i}">✕</button></div>`),
  ].join('');
}
$('vfPhotos').addEventListener('click', (e) => {
  const vf = state.vf;
  const o = e.target.closest('[data-rm-old]');
  const n = e.target.closest('[data-rm-new]');
  if (!o && !n) return;
  if (!confirm('この写真を外しますか？')) return;
  if (o) { vf.photoIds = vf.photoIds.filter((x) => x !== o.dataset.rmOld); vf.removedPhotos.push(o.dataset.rmOld); }
  if (n) vf.newPhotos.splice(Number(n.dataset.rmNew), 1);
  renderVfPhotos();
});

$('vfSave').addEventListener('click', async () => {
  const vf = state.vf;
  const c = clientOf(vf.clientId);
  if (!c) { toast('お客さんが見つかりません'); return; }
  const date = $('vfDate').value || today();
  const free = vf.payment === '無料招待';
  const amount = free ? 0 : Math.max(0, parseInt(String($('vfAmount').value).normalize('NFKC'), 10) || 0);
  $('vfSave').disabled = true;
  try {
    const newIds = [];
    for (const data of vf.newPhotos) newIds.push(await addPhoto({ clientId: c.id, date, data }));
    for (const id of vf.removedPhotos) await deletePhoto(id);
    const data = {
      date, clientId: c.id, reservationId: vf.reservationId || '', course: vf.course,
      complaints: vf.complaints.map((x) => ({ name: x.name, side: `${x.L ? 'L' : ''}${x.R ? 'R' : ''}` })),
      complaintText: $('vfComplaintText').value.trim(),
      points: vf.points, memo: $('vfMemo').value.trim(),
      payment: vf.payment, amount, freeInvite: free,
      photoIds: [...vf.photoIds, ...newIds],
    };
    let id = vf.id;
    if (id) await updateVisit(id, data); else id = await addVisit(data);
    // 予約は「来院済み」に、初回来院日が空ならこの日を入れる
    if (vf.reservationId) await updateReservation(vf.reservationId, { status: 'done' });
    if (!c.firstVisit || c.firstVisit > date) await updateClient(c.id, { firstVisit: date });
    state.currentId = c.id;
    toast('カルテを保存しました');
    openVisitDetail(id);
  } finally {
    $('vfSave').disabled = false;
  }
});

// ----- 来院記録の詳細 -----
function openVisitDetail(id) {
  state.visitId = id;
  const v = state.visits.find((x) => x.id === id);
  if (v) state.currentId = v.clientId;
  renderVisitDetail();
  show('visitdetail');
}
async function renderVisitDetail() {
  const v = state.visits.find((x) => x.id === state.visitId);
  if (!v) { $('vdBody').innerHTML = '<p class="muted">保存中…</p>'; return; }
  const c = clientOf(v.clientId);
  $('vdBody').innerHTML = `
    <h1>${esc(dayLabel(v.date))} ${esc(c ? fullName(c) : '')}</h1>
    <div class="card">
      <dl class="info">
        <dt>コース</dt><dd>${v.course}分</dd>
        <dt>支払い</dt><dd>${v.freeInvite ? '無料招待（0円）' : `${esc(v.payment)}　${esc(yen(v.amount))}`}</dd>
        <dt>主訴</dt><dd>${esc(complaintText(v.complaints) || '—')}</dd>
        ${v.complaintText ? `<dt>主訴のメモ</dt><dd>${esc(v.complaintText)}</dd>` : ''}
        <dt>経穴</dt><dd>${esc(pointText(v.points) || '—')}</dd>
      </dl>
      ${v.memo ? `<div class="memo">${esc(v.memo)}</div>` : ''}
    </div>
    <div id="vdPhotos" class="photos big"></div>`;
  const imgs = await Promise.all((v.photoIds || []).map((pid) => getPhoto(pid).catch(() => null)));
  if (state.visitId !== v.id) return;
  $('vdPhotos').innerHTML = imgs.filter(Boolean).map((p) => `<div class="photo"><img src="${p.data}" alt="カルテ写真"></div>`).join('');
}
$('vdEdit').addEventListener('click', () => {
  const v = state.visits.find((x) => x.id === state.visitId);
  if (!v) return;
  state.visitFrom = 'visitdetail';
  openVisitForm({}, v);
});
$('vdDelete').addEventListener('click', async () => {
  const v = state.visits.find((x) => x.id === state.visitId);
  if (!v || !confirm('この来院記録（カルテ）を削除しますか？\n写真も消えます。元に戻せません。')) return;
  for (const pid of v.photoIds || []) await deletePhoto(pid);
  await deleteVisit(v.id);
  toast('削除しました');
  show('detail');
  renderDetail();
});

// 名前を外した「相談用」の文章を作ってコピーする
$('vdCopy').addEventListener('click', async () => {
  const v = state.visits.find((x) => x.id === state.visitId);
  if (!v) return;
  const c = clientOf(v.clientId) || {};
  const prof = [c.ageGroup, c.gender, c.job, c.height && `身長${c.height}cm`, c.weight && `体重${c.weight}kg`].filter(Boolean).join('・');
  const one = (x) => [
    `主訴：${complaintText(x.complaints) || 'なし'}${x.complaintText ? `（${x.complaintText}）` : ''}`,
    `経穴：${pointText(x.points) || 'なし'}`,
    x.memo ? `施術メモ：${x.memo}` : '',
  ].filter(Boolean).join('\n');
  const past = visitsOf(v.clientId).filter((x) => x.id !== v.id && x.date <= v.date).slice(0, 5);
  const text = [
    '【施術の相談】（お客さんの名前など、個人が特定できる情報は外しています）',
    `■ お客さん：${prof || '（未登録）'}`,
    `■ 今回（${v.date}・${v.course}分）`,
    one(v),
    past.length ? `■ これまでの経過（新しい順・${past.length}回分）\n${past.map((x) => `- ${x.date}（${x.course}分）\n${one(x).replace(/^/gm, '  ')}`).join('\n')}` : '',
    '■ 相談したいこと：',
  ].filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました。メモに名前が入っていないか確認してから貼ってください');
  } catch {
    prompt('コピーできなかったので、下の文を長押しでコピーしてください', text);
  }
});

// ---------- 設定 ----------
function fillSettingsForm() {
  const f = $('settingsForm');
  for (const k of ['ageGroups', 'genders', 'jobs', 'complaints']) f[k].value = state.settings[k].join('\n');
  fillCalForms();
}
function fillCalForms() {
  const st = state.settings;
  $('calForm').calUrl.value = st.calUrl || '';
  $('calForm').calSecret.value = st.calSecret || '';
  $('hoursForm').openTime.value = st.openTime;
  $('hoursForm').closeTime.value = st.closeTime;
  $('hoursForm').slotStep.value = String(st.slotStep);
  $('calStatus').textContent = isConfigured(st) ? '設定済み' : 'まだ設定されていません';
}
async function saveSettingsPart(part) {
  const next = { ...state.settings, ...part };
  try {
    await saveSettings(next);
    state.settings = next;
    toast('保存しました');
    return true;
  } catch {
    toast('保存できませんでした。電波を確認してください');
    return false;
  }
}
$('calForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = e.target.calUrl.value.trim();
  const secret = e.target.calSecret.value.trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    toast('URL は https://script.google.com/macros/s/…/exec の形で入れてください');
    return;
  }
  if (await saveSettingsPart({ calUrl: url, calSecret: secret })) {
    fillCalForms();
    renderResv();
    retryCalendar();
  }
});
$('makeSecret').addEventListener('click', () => {
  const f = $('calForm');
  if (f.calSecret.value && !confirm('合言葉を新しく作りますか？\n（GAS の SECRET も同じものに書きかえる必要があります）')) return;
  f.calSecret.value = makeSecret();
  toast('合言葉を作りました。「保存」を押してください');
});
$('copySecret').addEventListener('click', async () => {
  const v = $('calForm').calSecret.value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); toast('コピーしました'); }
  catch { $('calForm').calSecret.select(); toast('長押しでコピーしてください'); }
});
$('calTest').addEventListener('click', async () => {
  const f = $('calForm');
  const temp = { calUrl: f.calUrl.value.trim(), calSecret: f.calSecret.value.trim() };
  $('calStatus').textContent = '接続テスト中…';
  try {
    const r = await callCalendar(temp, { action: 'ping' });
    $('calStatus').textContent = `✅ つながりました（カレンダー：${r.calendar}）`;
  } catch (err) {
    const m = String(err.message || err);
    $('calStatus').textContent = m.includes('bad-secret') ? '❌ 合言葉が GAS とちがいます'
      : m.includes('calendar-not-found') ? '❌ GAS のカレンダーIDがちがいます'
      : m.includes('not-configured') ? '❌ URL と合言葉を入れてください'
      : `❌ つながりませんでした（${m}）`;
  }
});
$('hoursForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.openTime.value || !f.closeTime.value || f.openTime.value > f.closeTime.value) { toast('時間を確認してください'); return; }
  await saveSettingsPart({ openTime: f.openTime.value, closeTime: f.closeTime.value, slotStep: Number(f.slotStep.value) });
});

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const next = { ...state.settings };
  for (const k of ['ageGroups', 'genders', 'jobs', 'complaints']) {
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
