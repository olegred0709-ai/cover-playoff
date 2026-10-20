// Google Apps Script — принимает голоса с сайта и пишет их в эту таблицу.
// Листы создаются сами: «Голоса» (строка на человека), «Матчи» (строка на пару), «Итоги» (рейтинг обложек).

const VOTES = 'Голоса';
const MATCHES = 'Матчи';
const SUMMARY = 'Итоги';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const votes = sheet_(ss, VOTES, ['Время', 'Имя', 'Победитель', 'Финалист', 'Полуфиналисты', 'Время прохождения, сек', 'ID устройства', 'Браузер']);
    const matches = sheet_(ss, MATCHES, ['Время', 'ID устройства', 'Раунд', 'Победила', 'Проиграла']);

    // повторная отправка с того же устройства — игнорируем
    const ids = votes.getLastRow() > 1 ? votes.getRange(2, 7, votes.getLastRow() - 1, 1).getValues().flat() : [];
    if (ids.indexOf(data.voteId) !== -1) return json_({ ok: true, duplicate: true });

    const now = new Date();
    votes.appendRow([now, data.name, data.champion, data.finalist, data.semifinalists, data.durationSec, data.voteId, data.userAgent]);
    const rows = data.matches.map(m => [now, data.voteId, m.round, m.winner, m.loser]);
    if (rows.length) matches.getRange(matches.getLastRow() + 1, 1, rows.length, 5).setValues(rows);

    rebuildSummary();
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Пересчёт листа «Итоги». Можно запустить вручную из редактора.
function rebuildSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const votes = ss.getSheetByName(VOTES);
  const matches = ss.getSheetByName(MATCHES);
  if (!votes || !matches) return;

  const stats = {};
  const get = t => (stats[t] = stats[t] || { champ: 0, final: 0, wins: 0, losses: 0 });

  if (votes.getLastRow() > 1) {
    votes.getRange(2, 3, votes.getLastRow() - 1, 2).getValues().forEach(([champ, fin]) => {
      if (champ) get(champ).champ++;
      if (fin) get(fin).final++;
    });
  }
  if (matches.getLastRow() > 1) {
    matches.getRange(2, 4, matches.getLastRow() - 1, 2).getValues().forEach(([w, l]) => {
      if (w) get(w).wins++;
      if (l) get(l).losses++;
    });
  }

  const rows = Object.keys(stats).map(t => {
    const s = stats[t];
    const games = s.wins + s.losses;
    return [t, s.champ, s.final, s.wins, s.losses, games ? s.wins / games : 0];
  });
  // главное — сколько раз выбрали победителем, дальше — финалы и доля побед в парах
  rows.sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[5] - a[5]);

  const sum = sheet_(ss, SUMMARY, ['Обложка', 'Выбрана победителем', 'Дошла до финала и проиграла', 'Побед в парах', 'Поражений в парах', 'Доля побед']);
  if (sum.getLastRow() > 1) sum.getRange(2, 1, sum.getLastRow() - 1, 6).clearContent();
  if (rows.length) {
    sum.getRange(2, 1, rows.length, 6).setValues(rows);
    sum.getRange(2, 6, rows.length, 1).setNumberFormat('0%');
  }
}

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
