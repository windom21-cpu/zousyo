import {
  getPAT, setPAT, getNick, setNick, getPATSetAt,
  getNextInviteNum, setNextInviteNum, formatInviteNum,
  config, fetchData, commitMutation, normalize,
  startBarcodeScan, stopBarcodeScan, SCAN_FORMAT_QR_CODE
} from './core.js?v=2.16';
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
    }, { formats: [SCAN_FORMAT_QR_CODE], fps: 15, qrbox: { width: 220, height: 220 } });
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

  // 統合元 select: 既存シリーズ + 「複数選択する」
  const fromSel = $('mergeFromSelect');
  fromSel.innerHTML = '';
  fromSel.appendChild(new Option('-- 選択 --', ''));
  for (const s of arr) {
    const count = allItems.filter(i => i.series === s).length;
    fromSel.appendChild(new Option(`${s} (${count}冊)`, s));
  }
  fromSel.appendChild(new Option('--- 複数選択する ---', '__multi__'));

  // 統合先 select: 既存シリーズ + 「新規入力する」
  const toSel = $('mergeToSelect');
  toSel.innerHTML = '';
  toSel.appendChild(new Option('-- 選択 --', ''));
  for (const s of arr) {
    toSel.appendChild(new Option(s, s));
  }
  toSel.appendChild(new Option('--- 新規入力する ---', '__new__'));

  // 複数選択モード用テーブル
  const table = $('mergeFromTable');
  table.innerHTML = '<thead><tr><th>選択</th><th>シリーズ</th><th>冊数</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  if (arr.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">シリーズが登録されていません</td></tr>';
  } else {
    arr.forEach((s, i) => {
      const count = allItems.filter(i2 => i2.series === s).length;
      const cbId = `mfcb_${i}`;
      const tr = document.createElement('tr');
      // 98.cssは <input> + <label> の隣接ペアでチェックボックスを描画
      tr.innerHTML = `<td><input type="checkbox" id="${cbId}" data-series="${escHtml(s)}"><label for="${cbId}"></label></td><td>${escHtml(s)}</td><td>${count}</td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', (e) => {
        const cb = tr.querySelector('input[type=checkbox]');
        if (!cb) return;
        // checkbox自身 or 対応する<label>クリックはブラウザが既にトグル済み。
        // それ以外(行の余白部分など)はここで手動トグル
        const isCb = e.target === cb;
        const isLbl = e.target.tagName === 'LABEL' && e.target.htmlFor === cb.id;
        if (!isCb && !isLbl) cb.checked = !cb.checked;
        refreshMergePreview();
      });
    });
  }

  // 表示状態リセット
  $('mergeFromWrap').style.display = 'none';
  $('mergeToInput').style.display = 'none';
  $('mergeToInput').value = '';
  refreshMergePreview();
}
loadSeriesOptions();

// モード切替: 統合元
$('mergeFromSelect').addEventListener('change', () => {
  const v = $('mergeFromSelect').value;
  $('mergeFromWrap').style.display = (v === '__multi__') ? '' : 'none';
  refreshMergePreview();
});
// モード切替: 統合先
$('mergeToSelect').addEventListener('change', () => {
  const v = $('mergeToSelect').value;
  if (v === '__new__') {
    $('mergeToInput').style.display = '';
    $('mergeToInput').value = '';
    $('mergeToInput').focus();
  } else {
    $('mergeToInput').style.display = 'none';
  }
  refreshMergePreview();
});
$('mergeToInput').addEventListener('input', refreshMergePreview);

function getSelectedSources() {
  if ($('mergeFromSelect').value === '__multi__') {
    return Array.from($('mergeFromTable').querySelectorAll('input[type=checkbox]:checked'))
      .map(cb => cb.dataset.series);
  }
  const v = $('mergeFromSelect').value;
  return v ? [v] : [];
}
function getMergeTarget() {
  if ($('mergeToSelect').value === '__new__') {
    return $('mergeToInput').value.trim();
  }
  return $('mergeToSelect').value;
}

function refreshMergePreview() {
  const sources = getSelectedSources();
  const to = getMergeTarget();
  if (sources.length === 0 || !to) {
    $('mergePreview').textContent = '';
    $('mergeApply').disabled = true;
    return;
  }
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

$('mergeApply').addEventListener('click', async () => {
  const sources = getSelectedSources();
  const to = getMergeTarget();
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
