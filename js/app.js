// 画面の動き。データの読み書きは store.js の関数だけを使う。
import {
  initStore, isLocalMode, signIn, signOut,
  watchClients, saveClient, deleteClient,
  watchReservations, addReservation, updateReservation,
  getSettings, saveSettings, exportAll,
} from './store.js';
import { eventTitle, toIso, isConfigured, callCalendar, makeSecret } from './calendar.js';
import { REFERRAL_TYPES, INITIALS } from './defaults.js';

const $ = (id) => document.getElementById(id);
const state = {
  clients: [],
  settings: null,
  resv: [],
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
  $('rdDone').hidden = r.status !== 'booked';
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
$('rdDone').addEventListener('click', async () => {
  const r = curResv();
  if (!r) return;
  await updateReservation(r.id, { status: 'done' });
  toast('来院済みにしました（カルテ入力はステップ3で追加します）');
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

// ---------- 設定 ----------
function fillSettingsForm() {
  const f = $('settingsForm');
  for (const k of ['ageGroups', 'genders', 'jobs']) f[k].value = state.settings[k].join('\n');
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
