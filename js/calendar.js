// Google カレンダー係。Google Apps Script（GAS）に「予定を作って／変えて／消して」と頼む。
// 予定に入れるのは「名字＋頭文字＋コース」だけ。健康の情報は送らない。
export function eventTitle(client, course) {
  return `${client?.lastName || '？'}${client?.initial || ''} ${course}分`;
}

// 'YYYY-MM-DD' と 'HH:MM' から、日本時間の日時（ISO形式）を作る
export function toIso(date, time, addMin = 0) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + addMin;
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setTime(d.getTime() + total * 60000);
  const j = new Date(d.getTime() + 9 * 3600000); // 日本時間に直して文字にする
  return j.toISOString().slice(0, 19) + '+09:00';
}

export function isConfigured(settings) {
  return Boolean(settings?.calUrl && settings?.calSecret);
}

// GAS に頼む。text/plain で送ると、ブラウザの事前確認（CORS）が要らない
export async function callCalendar(settings, payload) {
  if (!isConfigured(settings)) throw new Error('not-configured');
  const res = await fetch(settings.calUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, secret: settings.calSecret }),
    redirect: 'follow',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'calendar-error');
  return data;
}

// 合言葉（推測されにくいランダムな文字列）を作る
export function makeSecret() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
