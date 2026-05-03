import {
  uuid, lookupISBN, commitMutation, fetchData,
  findDuplicate, parseVolume, getNick, guessSeriesFromTitle
} from './core.js?v=1.3';

const $ = id => document.getElementById(id);
const queue = [];
let scanner = null;
let existing = { items: [] };

(async () => {
  $('saveStatus').textContent = '既存蔵書を読み込み中...';
  existing = await fetchData();
  $('saveStatus').textContent = `既存蔵書: ${existing.items.length}冊(重複検出に使用)`;
})();

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

function render() {
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
  queue.forEach((q, i) => {
    const b = q.book || {};
    html += `<tr>
      <td>${i+1}</td>
      <td>${esc(q.isbn)}</td>
      <td>${esc(b.series || '')}</td>
      <td>${b.volume ?? ''}</td>
      <td>${esc(b.title || '')}</td>
      <td>${statusHtml(q)}</td>
      <td><button data-i="${i}" class="delBtn">×</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  $('queueWrap').innerHTML = html;
  for (const b of $('queueWrap').querySelectorAll('.delBtn')) {
    b.addEventListener('click', () => {
      queue.splice(Number(b.dataset.i), 1);
      render();
    });
  }
}

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
    entry.status = 'error';
    entry.err = '書誌取得失敗';
    render();
    return;
  }

  const vol = parseVolume(r.volume) ?? parseVolume(r.title);
  const series = guessSeriesFromTitle(r.title) || r.series || '';
  entry.book = {
    series,
    seriesYomi: r.yomi || '',
    title: r.title || '',
    author: r.author || '',
    publisher: r.publisher || '',
    isbn: r.isbn || isbn,
    coverUrl: r.coverUrl || '',
    volume: vol
  };

  if (!series || vol == null) {
    entry.status = 'error';
    entry.err = !series ? 'シリーズ名取得失敗' : '巻数取得失敗';
    render();
    return;
  }

  if (findDuplicate(existing.items, { series, volume: vol, edition: '' })) {
    entry.status = 'duplicate';
  } else {
    entry.status = 'ok';
  }
  render();
}

$('scanStart').addEventListener('click', async () => {
  if (typeof Html5Qrcode === 'undefined') {
    $('scanStatus').innerHTML = '<span class="error">スキャナのロード待ち。少し待って再試行。</span>';
    return;
  }
  scanner = new Html5Qrcode('reader');
  $('scanStart').disabled = true;
  $('scanStop').disabled = false;
  $('scanStatus').textContent = 'カメラ起動中...';
  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 120 } },
      async (decoded) => {
        const code = decoded.replace(/\D/g, '');
        if (!/^97[89]/.test(code)) return;
        await handleScan(code);
      },
      () => {}
    );
    $('scanStatus').textContent = 'スキャン中。次々にバーコードを読ませてください';
  } catch (e) {
    $('scanStatus').innerHTML = `<span class="error">カメラ起動失敗: ${e.message || e}</span>`;
    $('scanStart').disabled = false;
    $('scanStop').disabled = true;
  }
});

async function stopScan() {
  if (scanner) {
    try { await scanner.stop(); await scanner.clear(); } catch (e) {}
    scanner = null;
  }
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
    edition: '',
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
