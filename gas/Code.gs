/**
 * 昇起施術所 予約 → Google カレンダー連携（Google Apps Script）
 *
 * アプリから「予定を作って／変えて／消して」と頼まれたら、
 * カレンダー「昇起施術所 予約」に反映する小さなプログラム。
 * 予定の名前は「名字＋頭文字＋コース」（例：田中K 90分）だけ。健康の情報は受け取らない。
 *
 * ▼ 先生が書きかえるのは、下の2行だけ
 *   CALENDAR_ID … カレンダーの設定画面の「カレンダー ID」
 *   SECRET      … アプリの「設定 → カレンダー連携 → 合言葉を作る」で出た文字列
 */
const CALENDAR_ID = 'ここにカレンダーIDを貼る';
const SECRET = 'ここに合言葉を貼る';

const REMIND_MINUTES = 60; // 何分前に通知するか

function doPost(e) {
  const lock = LockService.getScriptLock(); // 2台から同時に頼まれても、1つずつ順番に処理する
  try {
    lock.waitLock(20000);
    const req = JSON.parse(e.postData.contents);
    if (!SECRET || SECRET.indexOf('ここに') === 0 || req.secret !== SECRET) {
      return reply({ ok: false, error: 'bad-secret' });
    }
    const cal = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!cal) return reply({ ok: false, error: 'calendar-not-found' });

    if (req.action === 'ping') {
      return reply({ ok: true, calendar: cal.getName() });
    }
    if (req.action === 'upsert') {
      const title = String(req.title || '').slice(0, 50);
      const start = new Date(req.start);
      const end = new Date(req.end);
      if (isNaN(start) || isNaN(end) || end <= start) return reply({ ok: false, error: 'bad-time' });
      let ev = req.eventId ? safeGet(cal, req.eventId) : null;
      if (ev) {
        ev.setTitle(title);
        ev.setTime(start, end);
      } else {
        // 同じ時間・同じ名前の予定がもうあれば、それを使う（2台から同時に送られても重ならないように）
        ev = cal.getEvents(start, end).filter(function (x) {
          return x.getTitle() === title && x.getStartTime().getTime() === start.getTime();
        })[0] || null;
      }
      if (!ev) {
        ev = cal.createEvent(title, start, end);
        ev.removeAllReminders();
        ev.addPopupReminder(REMIND_MINUTES);
      }
      return reply({ ok: true, eventId: ev.getId() });
    }
    if (req.action === 'delete') {
      const ev = req.eventId ? safeGet(cal, req.eventId) : null;
      if (ev) ev.deleteEvent();
      return reply({ ok: true });
    }
    return reply({ ok: false, error: 'bad-action' });
  } catch (err) {
    return reply({ ok: false, error: 'server-error' });
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* なにもしない */ }
  }
}

function safeGet(cal, id) {
  try { return cal.getEventById(id); } catch (e) { return null; }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 設置したあと、エディタでこれを1回「実行」すると、カレンダーへのアクセスを許可する画面が出る */
function setupCheck() {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  Logger.log(cal ? 'OK：' + cal.getName() : 'カレンダーが見つかりません。CALENDAR_ID を確認してください');
}
