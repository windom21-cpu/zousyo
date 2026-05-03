#!/bin/bash
# バージョン番号を一括で上げるためのヘルパー。
# 使い方: ./bump.sh 2.0
# 効果:
#   - assets/config.js の version を 'v<NEW>' に更新
#   - 全HTML/JS の ?v=<OLD> を ?v=<NEW> に置換
#   - 1ファイル抜けるとそこだけブラウザキャッシュで動かなくなる事故を防ぐ
set -euo pipefail

NEW="${1:-}"
if [[ -z "$NEW" ]]; then
  echo "usage: $0 <new-version-number>"
  echo "  例: $0 2.0   →  v2.0 にバンプ"
  exit 1
fi

OLD=$(grep -oE "version: 'v[0-9.]+'" assets/config.js | sed -E "s/version: 'v([0-9.]+)'/\1/")
if [[ -z "$OLD" ]]; then
  echo "error: 現バージョンを読み取れませんでした(assets/config.js)"
  exit 1
fi

if [[ "$OLD" == "$NEW" ]]; then
  echo "現在 v$OLD と同じです。終了。"
  exit 0
fi

echo "v$OLD  →  v$NEW"
perl -i -pe "s/\\?v=\\Q${OLD}\\E/?v=${NEW}/g" *.html assets/*.js
perl -i -pe "s/version: 'v\\Q${OLD}\\E'/version: 'v${NEW}'/" assets/config.js

echo "完了。git diff で確認してください。"
