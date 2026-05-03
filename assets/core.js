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
const PAT_DATE_KEY = 'kbooks_pat_set_at';
const NEXT_INVITE_KEY = 'kbooks_next_invite_num';

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

// QR招待URL(?token=...&nick=... または #token=...&nick=...)からPATとニックを取り込み、
// URLからは即除去。フラグメントはAndroidの一部スキャナで落とされる事例があるため、
// クエリ・フラグメント両対応にしている。
(function bootstrapTokenFromUrl() {
  const h = location.hash || '';
  const q = location.search || '';
  const find = (str, name) => str.match(new RegExp('[?#&]' + name + '=([^&]+)'));

  const tm = find(q, 'token') || find(h, 'token');
  if (!tm) return;

  let token = '';
  try { token = decodeURIComponent(tm[1]); } catch (e) { console.error('[k-books] token decode failed', e); return; }
  if (!token) return;

  localStorage.setItem(PAT_KEY, token);
  localStorage.setItem(PAT_DATE_KEY, new Date().toISOString().slice(0, 10));

  let receivedNick = '';
  const nm = find(q, 'nick') || find(h, 'nick');
  if (nm) {
    try { receivedNick = decodeURIComponent(nm[1]); } catch (e) {}
    if (receivedNick) localStorage.setItem(NICK_KEY, receivedNick);
  }

  console.log('[k-books] PAT received via URL (nick:', receivedNick || '(none)', ')');
  // クエリ・フラグメントごと丸ごと消す(URLにPATが残らないようにする)
  history.replaceState(null, '', location.pathname);

  window.addEventListener('DOMContentLoaded', () => {
    const t = document.createElement('div');
    t.textContent = receivedNick
      ? `PATを受け取りました(ニックネーム: ${receivedNick})`
      : 'PATを受け取りました';
    t.style.cssText = 'position:fixed;top:8px;right:8px;background:#000080;color:#fff;padding:6px 10px;font:12px "MS UI Gothic",sans-serif;z-index:9999;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  });
})();

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

// 招待番号(あなた=001、家族は002から)。文字列で扱う(ゼロ埋め保持)
export function getNextInviteNum() {
  const v = localStorage.getItem(NEXT_INVITE_KEY);
  return v ? parseInt(v, 10) : 2;
}
export function setNextInviteNum(n) {
  if (Number.isFinite(n) && n >= 1) localStorage.setItem(NEXT_INVITE_KEY, String(n));
}
export function formatInviteNum(n) {
  return String(n).padStart(3, '0');
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
    let coverUrl = s.cover || '';
    // openBDが表紙を持っていない場合(マンガ系出版社で多い)Google Booksに
    // フォールバック。CORS対応済の公開APIのためブラウザから直接呼べる
    if (!coverUrl) {
      coverUrl = await fetchGoogleBooksCover(clean);
    }
    return {
      isbn: s.isbn || clean,
      title: s.title || '',
      series: s.series || '',
      volume: s.volume || '',
      author: s.author || '',
      publisher: s.publisher || '',
      coverUrl,
      yomi: collation
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function fetchGoogleBooksCover(isbn) {
  if (!isbn) return '';
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    if (!r.ok) return '';
    const j = await r.json();
    const thumb = j.items?.[0]?.volumeInfo?.imageLinks?.thumbnail || '';
    // mixed contentを避けるためHTTPS化
    return thumb ? thumb.replace(/^http:/, 'https:') : '';
  } catch (e) {
    return '';
  }
}

// 表紙URL再取得(編集画面の「再取得」ボタンから呼ばれる)
export async function refreshCoverUrl(isbn) {
  const r = await lookupISBN(isbn);
  return r?.coverUrl || '';
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

// html5-qrcodeのフォーマット番号(ライブラリ依存)
// EAN_13 = 9 (ISBNバーコード), QR_CODE = 0
export const SCAN_FORMAT_EAN_13 = 9;
export const SCAN_FORMAT_QR_CODE = 0;

// バーコードスキャン: facingMode で起動 → 失敗時は user に切替 →
// それでもダメなら getCameras() で列挙して順に試行。
// 端末によって何が通るかは予測困難なので段階的にフォールバック。
//
// options:
//   formats: [number]     スキャン対象フォーマットを限定(認識速度向上)
//   fps:     number       フレームレート(default 15)
//   qrbox:   {width, height} スキャン対象領域
export async function startBarcodeScan(readerId, onCode, options = {}) {
  if (typeof Html5Qrcode === 'undefined') {
    throw new Error('スキャナのロード待ち。少し待って再試行してください。');
  }
  const scanner = new Html5Qrcode(readerId);
  const config = {
    fps: options.fps || 15,
    qrbox: options.qrbox || { width: 280, height: 120 },
    // BarcodeDetector APIが使える環境(iOS Safari 16.4+ / 最新Chrome等)では
    // 内部でネイティブAPIを使い、認識が大幅に高速化される
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };
  // フォーマット限定でスキャン速度向上(指定なしは全フォーマット試行=遅い)
  if (Array.isArray(options.formats) && options.formats.length) {
    config.formatsToSupport = options.formats;
  }
  // QR(URL文字列)もISBNバーコードもそのまま渡す。呼出側で必要な処理(数字抽出等)を行う
  const decode = async (decoded) => {
    onCode(String(decoded || ''));
  };

  const attempts = [
    { facingMode: 'environment' },
    { facingMode: 'user' }
  ];
  let lastError = null;
  for (const constraint of attempts) {
    try {
      await scanner.start(constraint, config, decode, () => {});
      return scanner;
    } catch (e) {
      lastError = e;
      console.warn('[k-books] camera attempt failed:', constraint, e);
    }
  }

  try {
    const cams = await Html5Qrcode.getCameras();
    if (cams && cams.length) {
      for (const c of cams) {
        try {
          await scanner.start(c.id, config, decode, () => {});
          return scanner;
        } catch (e) {
          lastError = e;
          console.warn('[k-books] camera id failed:', c.id, c.label, e);
        }
      }
    }
  } catch (e) {
    lastError = e;
  }

  const msg = (lastError && lastError.message) || String(lastError) || '原因不明';
  throw new Error(`カメラ起動失敗: ${msg}`);
}

export async function stopBarcodeScan(scanner) {
  if (!scanner) return;
  try { await scanner.stop(); } catch (e) {}
  try { await scanner.clear(); } catch (e) {}
}

// HTML側で透明な <input type="date"> を 📅ボタンの上にオーバーレイ配置し、
// タップをネイティブのdate inputに直接渡す方式。
// 動的createElement+showPickerはAndroid Chromeで不発になるケースがあるため
// この方式に変更。フォーカス時にテキスト値で同期、change時に書き戻す。
export function attachCalendarPicker(textInputId, pickerId) {
  const text = document.getElementById(textInputId);
  const picker = document.getElementById(pickerId);
  if (!text || !picker) return;
  picker.addEventListener('focus', () => {
    const cur = text.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(cur)) {
      picker.value = cur;
    } else {
      picker.value = new Date().toISOString().slice(0, 10);
    }
  });
  picker.addEventListener('change', () => {
    if (picker.value) text.value = picker.value;
  });
}
