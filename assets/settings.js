import { getPAT, setPAT, getNick, setNick, getPATSetAt, config, fetchData, commitMutation, normalize } from './core.js?v=2.1';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

const $ = id => document.getElementById(id);

$('cfgOwner').textContent = config.owner;
$('cfgRepo').textContent = config.repo;
$('cfgBranch').textContent = config.branch;
$('cfgFile').textContent = config.dataFile;

$('pat').value = getPAT();
$('nick').value = getNick();

function refreshPATSetAt() {
  const d = getPATSetAt();
  if (d) {
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    $('patSetAt').textContent = `この端末でPAT設定: ${d}(${days}日経過)`;
  } else {
    $('patSetAt').textContent = '';
  }
}
refreshPATSetAt();

$('patSave').addEventListener('click', () => {
  setPAT($('pat').value.trim());
  setNick($('nick').value.trim());
  $('patStatus').innerHTML = '<span style="color:#006400;">保存しました</span>';
  refreshPATSetAt();
});
$('patClear').addEventListener('click', () => {
  setPAT('');
  $('pat').value = '';
  $('patStatus').innerHTML = 'クリアしました';
  refreshPATSetAt();
});

$('qrShow').addEventListener('click', async () => {
  const pat = getPAT();
  if (!pat) {
    $('patStatus').innerHTML = '<span class="error">先にPATを保存してください</span>';
    return;
  }
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
  const url = `${base}#token=${encodeURIComponent(pat)}`;
  $('qrUrl').textContent = url;
  $('qrArea').style.display = 'block';
  await QRCode.toCanvas($('qrCanvas'), url, { width: 240, margin: 2 });
});
$('qrHide').addEventListener('click', () => {
  $('qrArea').style.display = 'none';
});

$('topQrShow').addEventListener('click', async () => {
  const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
  $('topQrUrl').textContent = url;
  $('topQrArea').style.display = 'block';
  await QRCode.toCanvas($('topQrCanvas'), url, { width: 240, margin: 2 });
});
$('topQrHide').addEventListener('click', () => {
  $('topQrArea').style.display = 'none';
});

// === シリーズ統合 ===
let allItems = [];
async function loadSeriesOptions() {
  const data = await fetchData();
  allItems = data.items;
  const set = new Set(allItems.map(i => i.series).filter(Boolean));
  const arr = [...set].sort((a,b) => a.localeCompare(b, 'ja'));
  for (const sel of [$('mergeFrom'), $('mergeTo')]) {
    sel.innerHTML = '<option value="">-- 選択 --</option>';
    for (const s of arr) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = `${s} (${allItems.filter(i => i.series === s).length}冊)`;
      sel.appendChild(o);
    }
  }
  refreshMergePreview();
}
loadSeriesOptions();

function refreshMergePreview() {
  const from = $('mergeFrom').value;
  const to = $('mergeTo').value;
  if (!from || !to) {
    $('mergePreview').textContent = '';
    $('mergeApply').disabled = true;
    return;
  }
  if (from === to) {
    $('mergePreview').innerHTML = '<span class="error">統合元と統合先が同じです</span>';
    $('mergeApply').disabled = true;
    return;
  }
  const target = allItems.filter(i => i.series === from);
  $('mergePreview').textContent = `${from} → ${to} に書換: ${target.length}冊`;
  $('mergeApply').disabled = target.length === 0;
}
$('mergeFrom').addEventListener('change', refreshMergePreview);
$('mergeTo').addEventListener('change', refreshMergePreview);

$('mergeApply').addEventListener('click', async () => {
  const from = $('mergeFrom').value;
  const to = $('mergeTo').value;
  if (!from || !to || from === to) return;
  const target = allItems.filter(i => i.series === from);
  if (!confirm(`${target.length}冊のシリーズ名を「${from}」→「${to}」に書き換えます。\n進めますか?`)) return;
  $('mergeStatus').textContent = '統合中...';
  try {
    await commitMutation(items => {
      for (const it of items) {
        if (it.series === from) it.series = to;
      }
    }, `merge series: ${from} → ${to} (${target.length}冊)`);
    $('mergeStatus').innerHTML = `<span style="color:#006400;">${target.length}冊を統合しました</span>`;
    await loadSeriesOptions();
  } catch (e) {
    $('mergeStatus').innerHTML = `<span class="error">${e.message}</span>`;
  }
});

// === 変更履歴 ===
$('historyLoad').addEventListener('click', async () => {
  const list = $('historyList');
  list.textContent = '読み込み中...';
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/commits?path=${config.dataFile}&per_page=30`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const commits = await r.json();
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let html = '<table border="1"><thead><tr><th>日時</th><th>メッセージ</th><th>SHA</th></tr></thead><tbody>';
    for (const c of commits) {
      const d = new Date(c.commit.author.date);
      const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const msg = (c.commit.message || '').split('\n')[0];
      const sha = c.sha.slice(0, 7);
      const ghUrl = `https://github.com/${config.owner}/${config.repo}/commit/${c.sha}`;
      html += `<tr><td>${esc(dStr)}</td><td>${esc(msg)}</td><td><a href="${ghUrl}" target="_blank">${sha}</a></td></tr>`;
    }
    html += '</tbody></table>';
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = `<span class="error">${e.message}</span>`;
  }
});
