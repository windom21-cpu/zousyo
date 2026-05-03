import {
  uuid, lookupISBN, commitMutation, fetchData,
  findDuplicate, parseVolume, getNick, guessSeriesFromTitle,
  findExistingSeries,
  startBarcodeScan, stopBarcodeScan, SCAN_FORMAT_EAN_13
} from './core.js?v=2.16';

const $ = id => document.getElementById(id);
const queue = [];
let scanner = null;
let existing = { items: [] };

const QUEUE_KEY = 'kbooks_bulk_queue';
function persistQueue() {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {}
}
function restoreQueue() {
  try {
    const s = localStorage.getItem(QUEUE_KEY);
    if (!s) return;
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) {
      queue.push(...arr);
    }
  } catch (e) {}
}

restoreQueue();

(async () => {
  $('saveStatus').textContent = '既存蔵書を読み込み中...';
  existing = await fetchData();
  $('saveStatus').textContent = `既存蔵書: ${existing.items.length}冊(重複検出に使用)`;
  populateSeriesDatalist();
  // 復元済キューがある場合、既存との重複は変わっている可能性があるので再判定
  if (queue.length > 0) {
    for (const q of queue) {
      if (q.status !== 'fetching') validateEntry(q);
    }
    render();
  }
})();

function populateSeriesDatalist() {
  const dl = document.getElementById('bulkSeriesList');
  if (!dl) return;
  dl.innerHTML = '';
  const set = new Set(existing.items.map(i => i.series).filter(Boolean));
  [...set].sort((a,b) => a.localeCompare(b, 'ja')).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  });
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch (e) {}
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function statusHtml(q) {
  switch (q.status) {
    case 'fetching': return '<span class="muted">取得中...</span>';
    case 'ok':       return '<span style="color:#006400;">OK</span>';
    case 'error':    return `<span class="error">${esc(q.err || 'エラー')}</span>`;
    case 'duplicate':return '<span class="error">既存と重複</span>';
    default:         return q.status;
  }
}

// 単行の状態判定(編集後・取得後で共通利用)
function validateEntry(entry) {
  const b = entry.book || {};
  const series = b.series || '';
  const vol = b.volume;
  if (!series || vol == null) {
    entry.status = 'error';
    entry.err = !series ? 'シリーズ名未入力' : '巻数未入力';
    return;
  }
  entry.err = '';
  if (findDuplicate(existing.items, { series, volume: vol, edition: b.edition || '', isbn: entry.isbn })) {
    entry.status = 'duplicate';
  } else {
    entry.status = 'ok';
  }
}

function render() {
  persistQueue();
  $('count').textContent = queue.length;
  const okCount = queue.filter(q => q.status === 'ok' || q.status === 'duplicate').length;
  $('saveAll').disabled = okCount === 0;

  if (queue.length === 0) {
    $('queueWrap').innerHTML = '<p class="muted">まだ何もスキャンされていません。</p>';
    return;
  }

  let html = '<table border="1"><thead><tr>';
  html += '<th>#</th><th>ISBN</th><th>シリーズ</th><th>巻</th><th>タイトル</th><th>状態</th><th></th>';
  html += '</tr></thead><tbody>';
  // 新しい読取が上に来るよう逆順で表示。#番号はスキャン順(配列内のインデックス+1)を保つ
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    const b = q.book || {};
    html += `<tr>
      <td>${i+1}</td>
      <td>${esc(q.isbn)}</td>
      <td>${esc(b.series || '')}</td>
      <td>${b.volume ?? ''}</td>
      <td>${esc(b.title || '')}</td>
      <td>${statusHtml(q)}</td>
      <td>
        <button data-i="${i}" class="editBtn">編集</button>
        <button data-i="${i}" class="delBtn">×</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  $('queueWrap').innerHTML = html;
  for (const b of $('queueWrap').querySelectorAll('.delBtn')) {
    b.addEventListener('click', () => {
      queue.splice(Number(b.dataset.i), 1);
      render();
    });
  }
  for (const b of $('queueWrap').querySelectorAll('.editBtn')) {
    b.addEventListener('click', () => openBulkEdit(Number(b.dataset.i)));
  }
}

let editingIdx = -1;

function openBulkEdit(idx) {
  const q = queue[idx];
  if (!q) return;
  editingIdx = idx;
  const b = q.book || {};
  $('ed_isbn').value = q.isbn || '';
  $('ed_series').value = b.series || '';
  $('ed_volume').value = b.volume ?? '';
  $('ed_edition').value = b.edition || '';
  $('ed_title').value = b.title || '';
  $('ed_author').value = b.author || '';
  $('ed_publisher').value = b.publisher || '';
  $('editPane').style.display = 'block';
  $('editPane').scrollIntoView({ behavior: 'smooth' });
}

$('ed_apply').addEventListener('click', () => {
  if (editingIdx < 0) return;
  const q = queue[editingIdx];
  if (!q) { editingIdx = -1; $('editPane').style.display = 'none'; return; }
  const seriesIn = $('ed_series').value.trim();
  const series = findExistingSeries(existing.items, seriesIn) || seriesIn;
  const newIsbn = $('ed_isbn').value.trim() || q.isbn;
  q.isbn = newIsbn;
  q.book = {
    ...(q.book || {}),
    series,
    volume: parseVolume($('ed_volume').value),
    edition: $('ed_edition').value,
    title: $('ed_title').value.trim(),
    author: $('ed_author').value.trim(),
    publisher: $('ed_publisher').value.trim(),
    isbn: newIsbn
  };
  validateEntry(q);
  $('editPane').style.display = 'none';
  editingIdx = -1;
  render();
});

$('ed_cancel').addEventListener('click', () => {
  $('editPane').style.display = 'none';
  editingIdx = -1;
});

async function handleScan(isbn) {
  if (queue.some(q => q.isbn === isbn)) {
    $('scanStatus').textContent = `重複(キュー内): ${isbn} 無視`;
    return;
  }
  const entry = { isbn, status: 'fetching', book: null };
  queue.push(entry);
  beep();
  $('scanStatus').textContent = `読取: ${isbn} (合計 ${queue.length}件)`;
  render();

  const r = await lookupISBN(isbn);
  if (!r) {
    entry.book = { series: '', volume: null, edition: '', title: '', author: '', publisher: '', isbn };
    entry.status = 'error';
    entry.err = '書誌取得失敗(編集ボタンから手入力で補えます)';
    render();
    return;
  }

  const vol = parseVolume(r.volume) ?? parseVolume(r.title);
  let series = guessSeriesFromTitle(r.title) || r.series || '';
  const canonical = findExistingSeries(existing.items, series);
  if (canonical) series = canonical;
  entry.book = {
    series,
    seriesYomi: r.yomi || '',
    title: r.title || '',
    author: r.author || '',
    publisher: r.publisher || '',
    isbn: r.isbn || isbn,
    coverUrl: r.coverUrl || '',
    volume: vol,
    edition: ''
  };
  validateEntry(entry);
  render();
}

$('scanStart').addEventListener('click', async () => {
  $('scanStart').disabled = true;
  $('scanStop').disabled = false;
  $('scanStatus').textContent = 'カメラ起動中...';
  try {
    scanner = await startBarcodeScan('reader', async (raw) => {
      const code = String(raw).replace(/\D/g, '');
      if (!/^97[89]/.test(code)) return;
      await handleScan(code);
    }, { formats: [SCAN_FORMAT_EAN_13], fps: 20 });
    $('scanStatus').textContent = 'スキャン中。次々にバーコードを読ませてください';
  } catch (e) {
    $('scanStatus').innerHTML = `<span class="error">${e.message}<br><small>HTTPS/カメラ権限/ブラウザ対応を確認</small></span>`;
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

$('clearAll').addEventListener('click', () => {
  if (queue.length === 0) return;
  if (!confirm('スキャン済みの全件をクリアしますか?')) return;
  queue.length = 0;
  render();
});

$('saveAll').addEventListener('click', async () => {
  await stopScan();

  const dups = queue.filter(q => q.status === 'duplicate');
  let includeDups = false;
  if (dups.length > 0) {
    includeDups = confirm(`既存蔵書と重複する ${dups.length} 件があります。\nOK = 重複も含めて全件登録\nキャンセル = 重複は除外して登録`);
  }

  const targets = queue.filter(q =>
    q.status === 'ok' || (q.status === 'duplicate' && includeDups)
  );
  if (targets.length === 0) {
    $('saveStatus').innerHTML = '<span class="error">登録対象が0件です</span>';
    return;
  }

  const nick = getNick();
  const today = new Date().toISOString().slice(0, 10);
  const newItems = targets.map(q => ({
    id: uuid(),
    series: q.book.series,
    seriesYomi: q.book.seriesYomi || '',
    volume: q.book.volume,
    edition: q.book.edition || '',
    title: q.book.title || '',
    author: q.book.author || '',
    publisher: q.book.publisher || '',
    isbn: q.book.isbn || q.isbn,
    coverUrl: q.book.coverUrl || '',
    addedBy: nick || '',
    note: '',
    acquiredAt: today
  }));

  $('saveStatus').textContent = `${newItems.length}件 保存中...`;
  try {
    await commitMutation(arr => {
      for (const it of newItems) arr.push(it);
    }, `bulk-add: ${newItems.length}冊`);
    $('saveStatus').innerHTML = `<span style="color:#006400;">${newItems.length}件登録しました</span>`;
    existing.items.push(...newItems);
    queue.length = 0;
    render();
  } catch (e) {
    $('saveStatus').innerHTML = `<span class="error">${e.message}</span>`;
  }
});

render();
