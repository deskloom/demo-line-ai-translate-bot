# LINE多言語グループ翻訳ボット（デモ）— Cloudflare Workers + D1

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
   `wrangler.jsonc` の `vars.GEMINI_MODEL` で変更可能（既定 `gemini-3.1-flash-lite`）。
6. Workerをデプロイする。
   ```
   npx wrangler deploy
   ```
   完了時に表示される `https://<worker-name>.<subdomain>.workers.dev` がWorkerのURLになる。
7. LINE Developers コンソールの「Messaging API設定」で、Webhook URLに
   `https://<worker-name>.<subdomain>.workers.dev/webhook` を設定し、
   「Webhookの利用」をオンにする（「検証」ボタンで疎通を確認できる）。
8. LINE Official Account Manager の「設定 > 応答設定」で「応答メッセージ」をオフにする
   （オンのままだとボットの翻訳返信とは別に自動応答が送られる）。
9. グループに招待して使う場合は、LINE Developers コンソールの「Messaging API設定」で
   「グループ・複数人チャットへの参加を許可する」をオンにする（既定はオフ）。

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
（ポートは18787番を指定。）

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
GEMINI_API_KEY=xxx npm run eval
```
`GEMINI_API_KEY` は環境変数から読み込む（未設定の場合は実APIを呼ばずにスキップする）。

1回の実行あたり実API呼び出しは最大25回（5ケース×5回。`emoji-only-no-reply`は
isUntranslatable()でモデル呼び出し自体をスキップするため0回）。構造化JSON出力で
`503 UNAVAILABLE` が断続的に返ることがあるため、ハーネスは503時のみ指数バックオフで
再試行する。

評価ハーネスの正規表現は、誤検知を避けるため狙いを絞っている。たとえば
`omitted-subject-third-person` は「Iが行為の主語になっているパターン」
（`I'm/I am going`, `I go/will go`）だけを禁止し、"I think he is ..." のような
ヘッジ表現は誤りとみなさない。また三人称の主語は `(he|Kenji)` のどちらでも合格とする
（文脈中の名前を使う訳も正解のため）。

#### 結果（実行日: 2026-09-25）

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

注: プロンプトのルール3は「固有名詞は書かれたまま保持し、翻訳・音訳しない」だが、
実際の出力は5回とも "Kenji"/"Kyoto" とローマ字表記だった（英文としてはこの方が自然）。
当初の判定基準はローマ字表記だけを合格にしておりルール3の文言と食い違っていたため、
実行後に `(Kenji|健二)` `(Kyoto|京都)` のどちらでも合格とする形へ修正した。
記録済み出力5件を新基準で再採点しても5/5（API呼び出しなし）。結果ファイルは未変更。

## 設計上の判断

- **機械的なプロンプトルール**: 「自信があれば」のような曖昧な指示ではなく、
  「1〜3語の述語なし断片＋直前に別話者の質問がある→その質問への回答として訳す」
  「主語省略＋直近の文脈が三人称の話題→話者を主語と推定しない（〜わ/〜よのような
  文末表現や、〜と思う/たぶんのようなヘッジ表現は主語推定の根拠にしない）」
  「固有名詞は書かれたまま保持する」という具体的で検証可能なルールを`src/translate.js`
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

- 返信は最大5通×1800字（`REPLY_CHAR_BUDGET`）。翻訳結果がこれを超えると超過分は送られず、
  最後のメッセージ末尾に「（以下省略）」を付ける。
- 言語判定は「かなが1文字でもあれば日本語」、かな無しの場合のみかな/漢字とラテン文字の比率で決めるヒューリスティックであり、統計的な
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
