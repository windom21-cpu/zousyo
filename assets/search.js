import { fetchData, commitMutation, normalize, attachCalendarPicker } from './core.js?v=2.9';

const $ = id => document.getElementById(id);
let allItems = [];
let fuse = null;
let editingId = null;

async function load() {
  $('status').textContent = '読み込み中...';
  const data = await fetchData();
  allItems = data.items;
  // 正規化キャッシュをアイテムに付与(検索精度向上)
  for (const it of allItems) {
    it._n_series = normalize(it.series);
    it._n_yomi = normalize(it.seriesYomi);
    it._n_title = normalize(it.title);
    it._n_author = normalize(it.author);
  }
  fuse = new Fuse(allItems, {
    keys: [
      { name: '_n_series', weight: 0.5 },
      { name: '_n_yomi',   weight: 0.3 },
      { name: '_n_title',  weight: 0.15 },
      { name: '_n_author', weight: 0.05 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 1
  });
  $('status').textContent = `登録冊数: ${allItems.length} 冊`;
  render($('q').value);
}

// 表記ゆれ(末尾スペース・全/半角・記号差)を吸収するため、
// 正規化後の値をグループキーに使う。表示名は最初に出現した表記を採用。
function groupBySeriesEdition(items) {
  const groups = new Map();
  for (const it of items) {
    const key = `${normalize(it.series)}__${normalize(it.edition || '')}`;
    if (!groups.has(key)) groups.set(key, { series: it.series, edition: it.edition || '', items: [] });
    groups.get(key).items.push(it);
  }
  const arr = [...groups.values()];
  arr.sort((a, b) => a.series.localeCompare(b.series, 'ja'));
  return arr;
}

function render(query) {
  const groupedDiv = $('grouped');
  if (!query.trim()) {
    renderSummary(groupedDiv, allItems);
    return;
  }
  const q = normalize(query);
  const candidates = fuse.search(q).map(r => r.item);
  const arr = groupBySeriesEdition(candidates);

  if (arr.length === 0) {
    groupedDiv.innerHTML = '<p class="muted">該当なし</p>';
    return;
  }

  let html = '';
  for (const g of arr) {
    g.items.sort((a, b) => (a.volume || 0) - (b.volume || 0));
    const max = Math.max(...g.items.map(i => i.volume || 0));
    const vols = g.items.map(i => i.volume).filter(v => v != null).sort((a,b) => a-b);
    const missing = findMissing(vols);
    html += `<table border="1" style="margin-bottom:12px;">`;
    html += `<thead><tr><th colspan="6">${esc(g.series)}${g.edition ? ' [' + esc(g.edition) + ']' : ''} — 所持 ${g.items.length}冊 / 最大 ${max}巻${missing.length ? ' / 抜け: ' + missing.join(',') : ''}</th></tr>`;
    html += `<tr><th>巻</th><th>タイトル</th><th>ISBN</th><th>登録者</th><th>登録日</th><th></th></tr></thead><tbody>`;
    for (const it of g.items) {
      html += `<tr>
        <td>${it.volume ?? ''}</td>
        <td>${esc(it.title || '')}</td>
        <td>${esc(it.isbn || '')}</td>
        <td>${esc(it.addedBy || '')}</td>
        <td>${esc(it.acquiredAt || '')}</td>
        <td><button data-id="${it.id}" class="editBtn">編集</button></td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }
  groupedDiv.innerHTML = html;
  for (const b of groupedDiv.querySelectorAll('.editBtn')) {
    b.addEventListener('click', () => openEdit(b.dataset.id));
  }
}

function renderSummary(div, items) {
  const arr = groupBySeriesEdition(items);
  if (arr.length === 0) {
    div.innerHTML = '<p class="muted">蔵書はまだありません。</p>';
    return;
  }
  let html = '<p class="muted">シリーズ一覧。クリックで詳細表示。検索語入力でも絞り込めます。</p>';
  html += '<table border="1"><thead><tr>';
  html += '<th>シリーズ</th><th>版</th><th>所持</th><th>最大巻</th><th>抜け</th>';
  html += '</tr></thead><tbody>';
  for (const g of arr) {
    const vols = g.items.map(i => i.volume).filter(v => v != null).sort((a,b) => a-b);
    const max = vols.length ? vols[vols.length - 1] : 0;
    const missing = findMissing(vols);
    html += `<tr style="cursor:pointer;" data-series="${esc(g.series)}">
      <td>${esc(g.series)}</td>
      <td>${esc(g.edition)}</td>
      <td>${g.items.length}</td>
      <td>${max || ''}</td>
      <td>${missing.length ? esc(missing.join(',')) : '-'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  div.innerHTML = html;
  for (const tr of div.querySelectorAll('tr[data-series]')) {
    tr.addEventListener('click', () => {
      $('q').value = tr.dataset.series;
      render($('q').value);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

function findMissing(vols) {
  if (vols.length === 0) return [];
  const min = vols[0], max = vols[vols.length - 1];
  const set = new Set(vols);
  const m = [];
  for (let i = min; i <= max; i++) if (!set.has(i)) m.push(i);
  return m;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function openEdit(id) {
  const it = allItems.find(x => x.id === id);
  if (!it) return;
  editingId = id;
  $('e_series').value = it.series || '';
  $('e_seriesYomi').value = it.seriesYomi || '';
  $('e_volume').value = it.volume ?? '';
  $('e_edition').value = it.edition || '';
  $('e_title').value = it.title || '';
  $('e_author').value = it.author || '';
  $('e_publisher').value = it.publisher || '';
  $('e_isbn').value = it.isbn || '';
  $('e_coverUrl').value = it.coverUrl || '';
  $('e_acquiredAt').value = it.acquiredAt || '';
  $('e_note').value = it.note || '';
  $('e_status').textContent = '';
  $('detail').style.display = 'block';
  $('detail').scrollIntoView({ behavior: 'smooth' });
}

$('e_cancel').addEventListener('click', () => {
  $('detail').style.display = 'none';
  editingId = null;
});

$('e_save').addEventListener('click', async () => {
  if (!editingId) return;
  $('e_status').textContent = '保存中...';
  try {
    await commitMutation(items => {
      const i = items.findIndex(x => x.id === editingId);
      if (i < 0) throw new Error('対象が見つかりません(他端末で削除された?)');
      const cur = items[i];
      cur.series = $('e_series').value.trim();
      cur.seriesYomi = $('e_seriesYomi').value.trim();
      cur.volume = Number($('e_volume').value) || null;
      cur.edition = $('e_edition').value;
      cur.title = $('e_title').value.trim();
      cur.author = $('e_author').value.trim();
      cur.publisher = $('e_publisher').value.trim();
      cur.isbn = $('e_isbn').value.trim();
      cur.coverUrl = $('e_coverUrl').value.trim();
      cur.acquiredAt = $('e_acquiredAt').value.trim();
      cur.note = $('e_note').value.trim();
    }, `update: ${$('e_series').value} ${$('e_volume').value}巻`);
    $('e_status').innerHTML = '<span style="color:#006400;">保存しました</span>';
    await load();
  } catch (e) {
    $('e_status').innerHTML = `<span class="error">${e.message}</span>`;
  }
});

$('e_delete').addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('削除しますか?')) return;
  $('e_status').textContent = '削除中...';
  try {
    const series = $('e_series').value;
    const vol = $('e_volume').value;
    await commitMutation(items => {
      const i = items.findIndex(x => x.id === editingId);
      if (i >= 0) items.splice(i, 1);
    }, `delete: ${series} ${vol}巻`);
    $('e_status').innerHTML = '<span style="color:#006400;">削除しました</span>';
    $('detail').style.display = 'none';
    editingId = null;
    await load();
  } catch (e) {
    $('e_status').innerHTML = `<span class="error">${e.message}</span>`;
  }
});

$('q').addEventListener('input', () => render($('q').value));
$('reload').addEventListener('click', load);
$('qClear').addEventListener('click', () => {
  $('q').value = '';
  render('');
  $('q').focus();
});

attachCalendarPicker('e_acquiredAt', 'e_acquiredAtPicker');
load();
