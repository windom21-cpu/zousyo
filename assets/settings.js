import {
  getPAT, setPAT, getNick, setNick, getPATSetAt,
  getNextInviteNum, setNextInviteNum, formatInviteNum,
  config, fetchData, commitMutation, normalize,
  startBarcodeScan, stopBarcodeScan, SCAN_FORMAT_QR_CODE
} from './core.js?v=2.11';
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

// 招待番号の表示同期
$('nextInviteNum').value = getNextInviteNum();
$('nextInviteNum').addEventListener('change', () => {
  const v = parseInt($('nextInviteNum').value, 10);
  if (Number.isFinite(v) && v >= 1) {
    setNextInviteNum(v);
  } else {
    $('nextInviteNum').value = getNextInviteNum();
  }
});

$('qrShow').addEventListener('click', async () => {
  const pat = getPAT();
  if (!pat) {
    $('patStatus').innerHTML = '<span class="error">先にPATを保存してください</span>';
    return;
  }
  const num = parseInt($('nextInviteNum').value, 10) || 2;
  const nick = formatInviteNum(num);
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
  const url = `${base}?token=${encodeURIComponent(pat)}&nick=${encodeURIComponent(nick)}`;
  $('qrUrl').textContent = url;
  $('qrAssignedNick').textContent = `この招待のニックネーム: ${nick}`;
  $('qrArea').style.display = 'block';
  await QRCode.toCanvas($('qrCanvas'), url, { width: 240, margin: 2 });
  // 表示成功後にカウントアップ
  setNextInviteNum(num + 1);
  $('nextInviteNum').value = num + 1;
});
$('qrHide').addEventListener('click', () => {
  $('qrArea').style.display = 'none';
});

// === 招待QR読取(PWA等で別ストレージになっている場合に使用) ===
let inviteScanner = null;
$('inviteScanStart').addEventListener('click', async () => {
  $('inviteScanStart').disabled = true;
  $('inviteScanStop').disabled = false;
  $('inviteScanStatus').textContent = 'カメラ起動中...';
  try {
    inviteScanner = await startBarcodeScan('inviteReader', async (raw) => {
      const text = String(raw || '');
      const find = (s, name) => s.match(new RegExp('[?#&]' + name + '=([^&]+)'));
      const tm = find(text, 'token');
      if (!tm) {
        $('inviteScanStatus').textContent = `読取: PATが含まれません(${text.slice(0, 60)})`;
        return;
      }
      let token = '', nick = '';
      try { token = decodeURIComponent(tm[1]); } catch (e) {}
      if (!token) {
        $('inviteScanStatus').textContent = '読取: tokenが空でした';
        return;
      }
      setPAT(token);
      const nm = find(text, 'nick');
      if (nm) {
        try { nick = decodeURIComponent(nm[1]); } catch (e) {}
        if (nick) setNick(nick);
      }
      $('pat').value = token;
      if (nick) $('nick').value = nick;
      $('patStatus').innerHTML = `<span style="color:#006400;">QRからPAT受信(ニックネーム: ${nick || '(未指定)'})</span>`;
      refreshPATSetAt();
      $('inviteScanStatus').textContent = '受信完了';
      await stopInviteScan();
    }, { formats: [SCAN_FORMAT_QR_CODE], fps: 15, qrbox: { width: 240, height: 240 } });
    $('inviteScanStatus').textContent = '招待QRをカメラに向けてください';
  } catch (e) {
    $('inviteScanStatus').innerHTML = `<span class="error">${e.message}</span>`;
    $('inviteScanStart').disabled = false;
    $('inviteScanStop').disabled = true;
  }
});

async function stopInviteScan() {
  await stopBarcodeScan(inviteScanner);
  inviteScanner = null;
  $('inviteScanStart').disabled = false;
  $('inviteScanStop').disabled = true;
}
$('inviteScanStop').addEventListener('click', stopInviteScan);
window.addEventListener('beforeunload', stopInviteScan);

$('topQrShow').addEventListener('click', async () => {
  const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
  $('topQrUrl').textContent = url;
  $('topQrArea').style.display = 'block';
  await QRCode.toCanvas($('topQrCanvas'), url, { width: 240, margin: 2 });
});
$('topQrHide').addEventListener('click', () => {
  $('topQrArea').style.display = 'none';
});

// === シリーズ統合・改名(複数選択対応) ===
let allItems = [];
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadSeriesOptions() {
  const data = await fetchData();
  allItems = data.items;
  const set = new Set(allItems.map(i => i.series).filter(Boolean));
  const arr = [...set].sort((a,b) => a.localeCompare(b, 'ja'));

  // 統合元: チェックボックスリスト(複数選択可)
  const list = $('mergeFromList');
  list.innerHTML = '';
  if (arr.length === 0) {
    list.innerHTML = '<p class="muted" style="margin:0;">シリーズが登録されていません</p>';
  } else {
    for (const s of arr) {
      const count = allItems.filter(i => i.series === s).length;
      const id = 'mf_' + s.replace(/[^\w]/g, '_') + '_' + count;
      const div = document.createElement('div');
      div.style.cssText = 'padding:1px 0;';
      div.innerHTML = `<input type="checkbox" id="${escHtml(id)}" data-series="${escHtml(s)}"><label for="${escHtml(id)}">${escHtml(s)} (${count}冊)</label>`;
      list.appendChild(div);
    }
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', refreshMergePreview);
    });
  }

  // 統合先: datalistで既存名サジェスト
  const dl = $('mergeToList');
  dl.innerHTML = '';
  for (const s of arr) {
    const o = document.createElement('option');
    o.value = s;
    dl.appendChild(o);
  }
  refreshMergePreview();
}
loadSeriesOptions();

function getSelectedSources() {
  return Array.from($('mergeFromList').querySelectorAll('input[type=checkbox]:checked'))
    .map(cb => cb.dataset.series);
}

function refreshMergePreview() {
  const sources = getSelectedSources();
  const to = $('mergeTo').value.trim();
  if (sources.length === 0 || !to) {
    $('mergePreview').textContent = '';
    $('mergeApply').disabled = true;
    return;
  }
  // 統合先と同じ名前の元はスキップ(自分→自分は無意味)
  const filtered = sources.filter(s => s !== to);
  if (filtered.length === 0) {
    $('mergePreview').innerHTML = '<span class="error">選択した統合元と統合先が同じです</span>';
    $('mergeApply').disabled = true;
    return;
  }
  const total = filtered.reduce((sum, s) => sum + allItems.filter(i => i.series === s).length, 0);
  const existsAlready = allItems.some(i => i.series === to);
  const verb = existsAlready ? '統合' : '改名';
  const list = filtered.length > 3
    ? `${filtered.slice(0, 3).join(', ')} 他${filtered.length - 3}件`
    : filtered.join(', ');
  $('mergePreview').textContent = `${list} → ${to}(${verb}): 合計${total}冊`;
  $('mergeApply').disabled = total === 0;
}
$('mergeTo').addEventListener('input', refreshMergePreview);

$('mergeApply').addEventListener('click', async () => {
  const sources = getSelectedSources();
  const to = $('mergeTo').value.trim();
  if (!sources.length || !to) return;
  const filtered = sources.filter(s => s !== to);
  if (!filtered.length) return;
  const total = filtered.reduce((sum, s) => sum + allItems.filter(i => i.series === s).length, 0);
  const existsAlready = allItems.some(i => i.series === to);
  const verb = existsAlready ? '統合' : '改名';
  const fromLabel = filtered.length === 1 ? filtered[0] : `${filtered.length}件のシリーズ`;
  if (!confirm(`${total}冊を「${fromLabel}」→「${to}」に${verb}します。\n進めますか?`)) return;
  $('mergeStatus').textContent = '実行中...';
  const fromSet = new Set(filtered);
  try {
    await commitMutation(items => {
      for (const it of items) {
        if (fromSet.has(it.series)) it.series = to;
      }
    }, `${existsAlready ? 'merge' : 'rename'} series: ${filtered.length}件 → ${to} (${total}冊)`);
    $('mergeStatus').innerHTML = `<span style="color:#006400;">${total}冊を${verb}しました</span>`;
    $('mergeTo').value = '';
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
