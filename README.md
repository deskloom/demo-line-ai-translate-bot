# LINE × AI 日英自動翻訳ボット（Cloudflare Workers + D1）

ポートフォリオ用のデモプロジェクトです。LINEのグループ/ルーム/1:1チャットに投稿された
メッセージを日本語⇄英語で自動翻訳して返信するボットを、Cloudflare Workers + D1 だけ
（ランタイムのnpm依存ゼロ、Web CryptoとfetchのみでLINE署名検証・Gemini呼び出しを実装）
で構築しました。会話データはすべて架空です（ホストファミリーと留学生の設定）。実在の
クライアント・案件・企業とは一切関係ありません。

**このデモの一番の特徴は、翻訳品質を勘ではなく数値で測る評価ハーネス（`eval/`）です。**
実際にGemini APIを叩いて各ケースを5回ずつ実行し、機械的な合否判定（正規表現の
must/mustNot、または「出力なしが正解」）を記録します。

## アーキテクチャ（テキスト図）

```
LINE Platform
   │  POST /webhook (X-Line-Signature: HMAC-SHA256)
   ▼
Cloudflare Worker (src/index.js)
   ├─ signature.js  … 署名検証（Web Crypto, 定数時間比較）。不正/欠落なら401
   ├─ 200を即返し、ctx.waitUntil() で以下を非同期実行
   │    ├─ lang.js      … ja/en判定・絵文字/スタンプのみ判定
   │    ├─ chunk.js     … 文字数予算での分割（判定と配分を同一関数で計算）
   │    ├─ db.js         → D1 (messages テーブル) に保存・直近文脈を取得
   │    ├─ translate.js … Gemini generateContent（構造化JSON出力）
   │    └─ line.js      … LINE Reply API（空文字は絶対に送らない／DRY_RUN対応）
   └─ scheduled() … 1時間毎のCronで RETENTION_HOURS 超過メッセージをD1から削除

eval/run-eval.js … 本番と同じ translate.js を使い、fixtures/*.json のケースを
                    N回実行して合否を記録・集計 → eval/results/<date>.json
```

## セットアップ

1. LINE Developers コンソールでチャネルを作成し、Messaging APIを有効化。
   `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` を取得する。
2. D1データベースを作成する。
   ```
   npx wrangler d1 create demo-line-ai-translate-bot-db
   ```
   出力された `database_id` を `wrangler.jsonc` のプレースホルダーに反映する。
3. マイグレーションを適用する（ローカル）。
   ```
   npx wrangler d1 migrations apply demo-line-ai-translate-bot-db --local
   ```
   本番へは `--remote` を付けて同じコマンドを実行する。
4. シークレットを設定する（本番）。
   ```
   npx wrangler secret put LINE_CHANNEL_SECRET
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   npx wrangler secret put GEMINI_API_KEY
   ```
   ローカル開発では `.dev.vars`（gitignore済み）に平文で置く。
5. Gemini APIキーを取得する（[ai.google.dev](https://ai.google.dev)）。モデル名は
   `wrangler.jsonc` の `vars.GEMINI_MODEL` で変更可能（既定 `gemini-3.1-flash-lite` —
   Google公式ドキュメントが低コスト・長期安定運用向けとして案内する現行モデル。
   2026-09-25 に context7 経由で `ai.google.dev` の最新ドキュメントを確認して選定した）。

## テストの実行方法

```
npm install
npm test
```

`node --test` でNode組み込みのテストランナーを使用。`fetch`はテストごとにモックし、
D1は `test/fakeD1.js`（`prepare().bind().run()/all()`のインメモリ実装）で代替する
ため、Cloudflareアカウントなしで完結する。

## 動作確認（実施済み）

以下はすべて実際に実行して確認した結果です（2026-09-25、Windows + Git Bash）。

### 1. ユニットテスト

```
npm test
```
結果: **43 tests, 43 pass, 0 fail**（signature / lang / chunk / translate / line / db / index の各モジュール）。

### 2. ローカル `wrangler dev`

```
npx wrangler d1 migrations apply demo-line-ai-translate-bot-db --local
npx wrangler dev --local --port 18787
```
（Windows環境ではデフォルトの8787番ポートが `bind(): アクセス許可で禁じられた方法で
ソケットにアクセスしようとしました (os error 10013)` で失敗したため、18787番に変更して
起動した。）

`.dev.vars` に `LINE_CHANNEL_SECRET` のみを設定（アクセストークン・Gemini鍵は未設定＝
DRY_RUN経路とモック翻訳経路を検証）し、以下を実施:

- 正しい署名で `tools/sign-request.js` から送信 → **`200 ok`**
- D1に1行保存されたことを確認:
  ```
  npx wrangler d1 execute demo-line-ai-translate-bot-db --local \
    --command "select id, source_id, speaker_label, lang, text, translation from messages"
  ```
  → `lang: "ja"`, `translation: "[mock ja->en] こんにちは、元気ですか？"` の行を確認。
- ログに `[line] DRY_RUN reply (no LINE_CHANNEL_ACCESS_TOKEN)` が出力され、LINEへは実際に
  送信せず、送信予定のペイロードだけがログされることを確認。
- 不正な署名（`--bad-signature`）で送信 → **`401 invalid signature`**
- 検証後、起動していた `wrangler dev` のプロセス（workerd・npxラッパー）は全て停止済み。
  ※本デモでは `wrangler deploy` や実Cloudflareアカウントへの操作は一切行っていない。

### 3. 評価ハーネスの実本番実行（Gemini API）

```
GEMINI_API_KEY="$(node -e "process.stdout.write(require('<gemini.local.json>').api_key)")" \
  node eval/run-eval.js
```
APIキーはコマンド実行中の環境変数としてのみ読み込み、画面出力・ファイルへの記録は
していない（キー自体はリポジトリ外のローカルファイルにのみ存在）。

1回の実行あたり実API呼び出しは最大25回（5ケース×5回。`emoji-only-no-reply`は
isUntranslatable()でモデル呼び出し自体をスキップするため0回）。実行時、Gemini側が
構造化JSON出力（`response_schema`指定）のリクエストに対して断続的に
`503 UNAVAILABLE`（"currently experiencing high demand"）を返したため、
`eval/run-eval.js`に503時のみ指数バックオフで再試行する処理（最大6回、8秒刻みで
延長）を追加している。これは翻訳品質の問題ではなくAPI側の一時的な混雑によるものと
判断した（同一プロンプトを単純な`generateContent`で試すと200が返り、
`response_schema`付きのときだけ503になることを個別に確認した）。

#### 評価ハーネス自体の不具合を2件見つけて直した経緯

プロンプトの短答例文を機密性の理由で別の通学手段の題材（「電車」）に
差し替えた後、実際にGemini APIで検証する過程で、モデルではなく**評価ハーネスの
チェック（正規表現）側の不備**を2件見つけて修正した。以前（差し替え前）の
Before/After生データはこの変更に伴い削除済みのため、ここでは経緯を文章でのみ記録し、
数値としてのBefore/Afterは示さない。

1. `omitted-subject-third-person`のmustNotMatchが`\bI\b`のような広すぎる
   パターンで、"I **think** he is going to karaoke."という単なる推量のヘッジ表現
   まで「主語を話者に取り違えた」と誤検知していた。実際のモデル出力は三人称
   （he）を正しく主語に保っていた。→ 「Iが行為の主語になっているパターン」
   （`I'm/I am going`, `I go/will go`）だけを禁止するよう修正。
2. 同じケースのmustMatchが`\bhe\b`のみを要求しており、モデルが文脈中の名前を
   使って"I think **Kenji** is going to karaoke."と訳した回（これはルール3
   「固有名詞はそのまま保持する」にも合致する、むしろ丁寧な訳）を不合格として
   いた。→ mustMatchを`\b(he|Kenji)\b`に広げ、どちらの表現でも合格とした。

いずれも「モデルの誤り」ではなく「チェック側が正解の言い換えを弾いていた」ケース
であり、モデルの振る舞いやプロンプトを変えて数値を良くしたわけではない。

#### 結果（最終実行: 2026-09-25 JST / ファイル内タイムスタンプはUTCで09-24）

| ケース | 結果 |
|---|---|
| omitted-subject-third-person | 5/5 |
| short-answer-ja-to-en | 5/5 |
| short-answer-en-to-ja | 5/5 |
| multi-paragraph-long-text | 5/5 |
| emoji-only-no-reply | 5/5 |
| proper-noun-preservation | 5/5 |

**全6ケース×5回 = 30/30合格。** モデルは `gemini-3.1-flash-lite`。
生データ: `eval/results/2026-09-25.json`。

## 設計上の判断

- **機械的なプロンプトルール**: 「自信があれば」のような曖昧な指示ではなく、
  「1〜3語の述語なし断片＋直前に別話者の質問がある→その質問への回答として訳す」
  「主語省略＋直近の文脈が三人称の話題→話者を主語と推定しない（〜わ/〜よのような
  文末表現や、〜と思う/たぶんのようなヘッジ表現は主語推定の根拠にしない）」
  「固有名詞はそのまま保持する」という具体的で検証可能なルールを`src/translate.js`
  のシステムプロンプトに明文化した。
- **空文字を絶対に送らない**: LINEの返信APIは空文字のテキストメッセージに400を返す。
  `src/line.js`の`replyText()`は空/空白のみのエントリを送信前にすべて除去し、送るもの
  が無ければ何もせずログするだけにする。
- **予算判定と配分計算を同一関数にする**: 「この文字数予算内で処理できるか」の判定
  （`fitsBudget`）と「実際にどう分割するか」の配分（`planChunks`）が別ロジックだと、
  判定は通ったのに配分結果は予算超過、という食い違いが起こりうる。
  `src/chunk.js`の`computeChunkPlan()`を唯一の実装とし、両方の関数がそれを呼ぶことで
  構造的に一致を保証している（`test/chunk.test.js`の
  "fitsBudget and planChunks agree by construction" で検証）。
- **保持期間（Retention）**: `RETENTION_HOURS`（既定72時間）を超えたメッセージは
  毎時のCron Trigger（`scheduled()`）でD1から削除する。会話ログを無期限に溜め込まない。

## 制限事項（正直に書く）

- 言語判定はかな/漢字とラテン文字の比率によるヒューリスティックであり、統計的な
  言語判定モデルではない。ja/en以外の言語や、極端に短い/記号だらけの文では誤判定
  しうる。
- 評価ハーネスのケース数は6件・各5回と小規模。統計的に厳密な精度保証ではなく、
  「壊れていないことを継続的に確認するための回帰テスト」という位置づけ。
- 話者名（`speaker_label`）はLINEプロフィールAPIが使える場合のみ表示名を使い、
  それ以外はuserIdの末尾6文字にフォールバックする簡易実装。
- `wrangler deploy`は一度も実行しておらず、実際のCloudflareアカウント・実LINE
  チャネルでの本番動作は未検証（`wrangler dev --local`のみで動作確認済み）。
- 本番Worker（`src/translate.js`）自体にはGemini APIのレート制限・エラー時の
  リトライは実装していない（1回失敗したらそのメッセージは翻訳されずログに残るのみ）。
  評価ハーネス（`eval/run-eval.js`）側のみ、実行時に確認された構造化出力の
  断続的な503エラーに対応するため、503限定の指数バックオフ再試行を追加している。

## ライセンス

MIT License. Copyright (c) 2026 deskloom. 詳細は `LICENSE` を参照。
