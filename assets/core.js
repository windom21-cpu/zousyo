const CFG = window.APP_CONFIG;
console.log(`[k-books] core.js loaded (${CFG.version})`);

// タイトルバーにバージョン表示(キャッシュ有無を一目で判断するため)
window.addEventListener('DOMContentLoaded', () => {
  const tb = document.querySelector('.title-bar-text');
  if (tb && CFG.version && !tb.textContent.includes(CFG.version)) {
    tb.textContent = `${tb.textContent} ${CFG.version}`;
  }
});

const PAT_KEY = 'kbooks_pat';
const NICK_KEY = 'kbooks_nick';

// 旧キーからの移行(プロジェクト名変更前に保存していたPAT/ニックを引き継ぐ)
(function migrateLegacyKeys() {
  for (const [oldKey, newKey] of [['zousyo_pat', PAT_KEY], ['zousyo_nick', NICK_KEY]]) {
    const old = localStorage.getItem(oldKey);
    if (old && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, old);
    }
    if (old) localStorage.removeItem(oldKey);
  }
})();

// QR招待URL(#token=...)で来たときにPATを取り込み、URLからは即除去
(function bootstrapTokenFromHash() {
  const h = location.hash;
  const m = h.match(/[#&]token=([^&]+)/);
  if (!m) return;
  const token = decodeURIComponent(m[1]);
  localStorage.setItem(PAT_KEY, token);
  const stripped = h.replace(/([#&])token=[^&]+&?/, '$1').replace(/[#&]$/, '');
  history.replaceState(null, '', location.pathname + location.search + stripped);
  // 軽い通知
  window.addEventListener('DOMContentLoaded', () => {
    const t = document.createElement('div');
    t.textContent = 'PATを受け取りました';
    t.style.cssText = 'position:fixed;top:8px;right:8px;background:#000080;color:#fff;padding:6px 10px;font:12px "MS UI Gothic",sans-serif;z-index:9999;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  });
})();

const PAT_DATE_KEY = 'kbooks_pat_set_at';

export function getPAT() {
  return localStorage.getItem(PAT_KEY) || '';
}
export function setPAT(t) {
  const cur = localStorage.getItem(PAT_KEY) || '';
  if (t) {
    localStorage.setItem(PAT_KEY, t);
    // 値が変わったタイミングで発行日(=この端末が知った日)を更新
    if (t !== cur) {
      localStorage.setItem(PAT_DATE_KEY, new Date().toISOString().slice(0, 10));
    }
  } else {
    localStorage.removeItem(PAT_KEY);
    localStorage.removeItem(PAT_DATE_KEY);
  }
}
export function getPATSetAt() {
  return localStorage.getItem(PAT_DATE_KEY) || '';
}
export function getNick() {
  return localStorage.getItem(NICK_KEY) || '';
}
export function setNick(n) {
  if (n) localStorage.setItem(NICK_KEY, n);
  else localStorage.removeItem(NICK_KEY);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// NFKC + 小文字化 + 記号類の単純化(検索キー作成用)
export function normalize(s) {
  if (!s) return '';
  return s.normalize('NFKC').toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!-/:-@\[-`{-~、。「」『』・，．]/g, '');
}

// PATがあれば認証付きAPI経由(CDNキャッシュ回避で常に最新)、無ければraw経由
export async function fetchData() {
  const token = getPAT();
  if (token) {
    try {
      const url = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.dataFile}?ref=${CFG.branch}`;
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'If-None-Match': ''
        },
        cache: 'no-store'
      });
      if (r.ok) {
        const j = await r.json();
        const bytes = Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        const data = JSON.parse(text);
        if (!data.items) data.items = [];
        return data;
      }
      if (r.status === 404) return { items: [] };
      console.warn(`API fetch returned ${r.status}, falling back to raw`);
    } catch (e) {
      console.warn('API fetch failed, falling back to raw', e);
    }
  }
  const url = `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/${CFG.dataFile}?_=${Date.now()}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      if (r.status === 404) return { items: [] };
      throw new Error(`fetchData ${r.status}`);
    }
    const json = await r.json();
    if (!json.items) json.items = [];
    return json;
  } catch (e) {
    console.error(e);
    return { items: [] };
  }
}

// SHA取得 + 競合時は再試行する書き込み
async function getFileMeta(token) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.dataFile}?ref=${CFG.branch}`;
  const r = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`
    }
  });
  if (r.status === 404) return { content: { items: [] }, sha: null };
  if (!r.ok) throw new Error(`getFileMeta ${r.status}`);
  const j = await r.json();
  const text = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ''))));
  return { content: JSON.parse(text), sha: j.sha };
}

function utf8ToBase64(s) {
  return btoa(unescape(encodeURIComponent(s)));
}

async function putFile(token, contentObj, sha, message) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.dataFile}`;
  const body = {
    message,
    content: utf8ToBase64(JSON.stringify(contentObj, null, 2) + '\n'),
    branch: CFG.branch
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return r;
}

// 直前PUT後のSHA+itemsをメモリに保持。GitHub読み取りレプリカの遅延を回避
let _cache = null;

export function invalidateCache() { _cache = null; }

// mutate(items): items配列を直接編集する関数を渡す。競合したら再取得して再適用
export async function commitMutation(mutate, message) {
  const token = getPAT();
  if (!token) throw new Error('PATが未設定です。設定画面でPATを入力してください。');
  let lastInfo = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    let items, sha, source;
    if (_cache && attempt === 0) {
      items = JSON.parse(JSON.stringify(_cache.items));
      sha = _cache.sha;
      source = 'cache';
    } else {
      const meta = await getFileMeta(token);
      items = meta.content.items;
      sha = meta.sha;
      source = 'fresh';
    }
    console.log(`[k-books] commitMutation attempt=${attempt} source=${source} sha=${sha?.slice(0,7)} items=${items.length}`);
    mutate(items);
    const r = await putFile(token, { items }, sha, message);
    if (r.ok) {
      const j = await r.json();
      const newSha = j?.content?.sha || null;
      _cache = newSha ? { items, sha: newSha } : null;
      console.log(`[k-books] commitMutation success newSha=${newSha?.slice(0,7)}`);
      return j;
    }
    const errBody = (await r.text()).slice(0, 250);
    lastInfo = `${r.status} ${errBody}`;
    console.warn(`[k-books] commitMutation attempt ${attempt} failed: ${lastInfo}`);
    if (r.status === 409 || r.status === 412 || r.status === 422) {
      _cache = null;
      const wait = 500 * Math.pow(1.6, attempt) + Math.random() * 300;
      await new Promise(res => setTimeout(res, wait));
      continue;
    }
    _cache = null;
    throw new Error(`保存失敗 ${lastInfo}`);
  }
  _cache = null;
  throw new Error(`競合再試行が上限に達しました(最後の応答: ${lastInfo})`);
}

// openBD: ISBN -> 書誌
export async function lookupISBN(isbn) {
  const clean = isbn.replace(/[^0-9X]/gi, '');
  try {
    const r = await fetch(`https://api.openbd.jp/v1/get?isbn=${clean}`);
    if (!r.ok) return null;
    const arr = await r.json();
    if (!arr || !arr[0]) return null;
    const b = arr[0];
    const s = b.summary || {};
    const onix = b.onix || {};
    const collation = onix.DescriptiveDetail?.TitleDetail?.TitleElement?.TitleText?.collationkey || '';
    return {
      isbn: s.isbn || clean,
      title: s.title || '',
      series: s.series || '',
      volume: s.volume || '',
      author: s.author || '',
      publisher: s.publisher || '',
      coverUrl: s.cover || '',
      yomi: collation
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

// 重複キー: series + volume + edition(ISBN欠落時のフォールバック用)
export function dupKey(item) {
  return `${normalize(item.series)}|${item.volume}|${normalize(item.edition || '')}`;
}

function isbnDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

// ISBNが揃っていればそれで判定(別作品の偶発一致を避ける)、無ければキーで
export function findDuplicate(items, candidate) {
  const isbn = isbnDigits(candidate.isbn);
  if (isbn) {
    const byIsbn = items.find(i => isbnDigits(i.isbn) === isbn);
    if (byIsbn) return byIsbn;
  }
  const k = dupKey(candidate);
  return items.find(i => dupKey(i) === k);
}

// 既存蔵書に「正規化後同じ」シリーズ名があれば、その正規表記を返す。
// 表記ゆれを増やさず、既存表記に寄せるための正規化ヘルパ。
export function findExistingSeries(items, candidateSeries) {
  if (!candidateSeries) return null;
  const n = normalize(candidateSeries);
  if (!n) return null;
  const match = items.find(i => normalize(i.series) === n);
  return match ? match.series : null;
}

// タイトルからシリーズ名を抽出(openBDの`series`フィールドはレーベル名で
// 別作品同士が同じ値になるため、こちらを優先する)
export function guessSeriesFromTitle(title) {
  if (!title) return '';
  let s = title;
  s = s.replace(/[\s　]*\(\d+\)\s*$/, '');         // "(17)"
  s = s.replace(/[\s　.,:、]*\d+(\s*巻)?\s*$/, ''); // "17" / "17巻" / ". 17"
  s = s.replace(/[\s　:：。\.\-‐ー]+$/, '');        // 末尾の余計な記号
  return s.trim();
}

// 巻数の数値抽出(「3」「第3巻」「3巻」「03」全部対応)
export function parseVolume(v) {
  if (v == null) return null;
  const s = String(v).normalize('NFKC');
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}

export const config = CFG;

// テキスト入力(YYYY-MM-DD)の隣のボタンを押すとカレンダーピッカーが開き、
// 選んだ日付を元のテキスト入力に書き戻す。
// レイアウトは98.css風の見た目を維持しつつ、機能だけネイティブに任せる。
export function attachCalendarPicker(textInputId, buttonId) {
  const text = document.getElementById(textInputId);
  const btn = document.getElementById(buttonId);
  if (!text || !btn) return;
  btn.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'date';
    picker.value = text.value || new Date().toISOString().slice(0, 10);
    picker.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;width:1px;height:1px;';
    document.body.appendChild(picker);
    const cleanup = () => setTimeout(() => picker.remove(), 200);
    picker.addEventListener('change', () => {
      if (picker.value) text.value = picker.value;
      cleanup();
    });
    picker.addEventListener('blur', cleanup);
    if (picker.showPicker) {
      try { picker.showPicker(); } catch (e) { picker.focus(); picker.click(); }
    } else {
      picker.focus();
      picker.click();
    }
  });
}
