import {
  uuid, lookupISBN, commitMutation, fetchData,
  findDuplicate, parseVolume, getNick, setNick, guessSeriesFromTitle,
  attachCalendarPicker, findExistingSeries,
  startBarcodeScan, stopBarcodeScan, SCAN_FORMAT_EAN_13
} from './core.js?v=2.10';

const $ = id => document.getElementById(id);
const fields = ['isbn','series','seriesYomi','volume','edition','title','author','publisher','coverUrl','addedBy','acquiredAt','note'];

function todayStr() { return new Date().toISOString().slice(0, 10); }

function readForm() {
  const o = {};
  for (const k of fields) o[k] = $(k).value.trim();
  return o;
}
function writeForm(o) {
  for (const k of fields) {
    if (o[k] != null) $(k).value = o[k];
  }
}
function clearForm() {
  for (const k of fields) $(k).value = '';
  $('edition').value = '';
  $('addedBy').value = getNick();
  $('acquiredAt').value = todayStr();
}

clearForm();
attachCalendarPicker('acquiredAt', 'acquiredAtPicker');

// 既存蔵書のシリーズ名をdatalistに流し込んでサジェスト表示
let existingItems = [];
(async () => {
  const data = await fetchData();
  existingItems = data.items;
  const seriesSet = new Set(existingItems.map(i => i.series).filter(Boolean));
  const dl = document.getElementById('seriesList');
  if (dl) {
    dl.innerHTML = '';
    [...seriesSet].sort((a,b) => a.localeCompare(b, 'ja')).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      dl.appendChild(opt);
    });
  }
})();

$('lookup').addEventListener('click', async () => {
  const isbn = $('isbn').value.trim();
  if (!isbn) { $('saveStatus').innerHTML = '<span class="error">ISBNを入力してください</span>'; return; }
  $('saveStatus').textContent = '取得中...';
  const r = await lookupISBN(isbn);
  if (!r) { $('saveStatus').innerHTML = '<span class="error">書誌が見つかりませんでした</span>'; return; }
  // 既存の手入力を上書きしないよう、空のフィールドだけ埋める
  const cur = readForm();
  if (!cur.title) $('title').value = r.title;
  if (!cur.series) $('series').value = guessSeriesFromTitle(r.title) || r.series || '';
  if (!cur.seriesYomi) $('seriesYomi').value = r.yomi;
  if (!cur.volume) {
    const v = parseVolume(r.volume) ?? parseVolume(r.title);
    if (v != null) $('volume').value = v;
  }
  if (!cur.author) $('author').value = r.author;
  if (!cur.publisher) $('publisher').value = r.publisher;
  if (!cur.coverUrl) $('coverUrl').value = r.coverUrl;
  $('saveStatus').textContent = '取得しました';
});

$('clear').addEventListener('click', clearForm);

$('save').addEventListener('click', async () => {
  const f = readForm();
  if (!f.series || !f.volume) {
    $('saveStatus').innerHTML = '<span class="error">シリーズ名と巻数は必須です</span>';
    return;
  }
  const vol = parseVolume(f.volume);
  if (vol == null) {
    $('saveStatus').innerHTML = '<span class="error">巻数は数値で入力してください</span>';
    return;
  }
  const candidate = {
    id: uuid(),
    series: f.series,
    seriesYomi: f.seriesYomi,
    volume: vol,
    edition: f.edition,
    title: f.title,
    author: f.author,
    publisher: f.publisher,
    isbn: f.isbn,
    coverUrl: f.coverUrl,
    addedBy: f.addedBy,
    note: f.note,
    acquiredAt: f.acquiredAt || todayStr()
  };

  // 事前チェック(競合の前に重複ヒットなら早期警告)
  $('saveStatus').textContent = '重複確認中...';
  const data = await fetchData();
  // 表記ゆれ吸収: 既存と正規化後同じシリーズ名なら既存表記を採用
  const canonical = findExistingSeries(data.items, candidate.series);
  if (canonical && canonical !== candidate.series) {
    candidate.series = canonical;
  }
  const dup = findDuplicate(data.items, candidate);
  if (dup) {
    if (!confirm(`既に登録されています:\n${dup.series} ${dup.volume}巻 (${dup.edition || '通常'})\nそれでも登録しますか?`)) {
      $('saveStatus').textContent = 'キャンセルしました';
      return;
    }
  }

  if (f.addedBy) setNick(f.addedBy);

  $('saveStatus').textContent = '保存中...';
  try {
    await commitMutation(items => {
      items.push(candidate);
    }, `add: ${candidate.series} ${candidate.volume}巻`);
    $('saveStatus').innerHTML = `<span style="color:#006400;">登録しました: ${candidate.series} ${candidate.volume}巻</span>`;
    clearForm();
  } catch (e) {
    $('saveStatus').innerHTML = `<span class="error">${e.message}</span>`;
  }
});

// バーコードスキャナ
let scanner = null;
$('scanStart').addEventListener('click', async () => {
  $('scanStart').disabled = true;
  $('scanStop').disabled = false;
  $('scanStatus').textContent = 'カメラ起動中...';
  try {
    scanner = await startBarcodeScan('reader', async (raw) => {
      const code = String(raw).replace(/\D/g, '');
      if (!/^97[89]/.test(code)) {
        $('scanStatus').textContent = `ISBN以外を検出: ${raw.slice(0, 30)} (無視)`;
        return;
      }
      $('scanStatus').textContent = `読取: ${code}`;
      $('isbn').value = code;
      await stopScan();
      $('lookup').click();
    }, { formats: [SCAN_FORMAT_EAN_13], fps: 20 });
    $('scanStatus').textContent = 'スキャン中...バーコードをカメラに向けてください';
  } catch (e) {
    $('scanStatus').innerHTML = `<span class="error">${e.message}<br><small>HTTPS/カメラ権限/ブラウザ対応を確認(セットアップ手順 → トラブルシューティング)</small></span>`;
    $('scanStart').disabled = false;
    $('scanStop').disabled = true;
  }
});

async function stopScan() {
  await stopBarcodeScan(scanner);
  scanner = null;
  $('scanStart').disabled = false;
  $('scanStop').disabled = true;
}
$('scanStop').addEventListener('click', stopScan);
window.addEventListener('beforeunload', stopScan);
