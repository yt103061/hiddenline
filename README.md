# アニマルライン / HIDDEN LINE

正体を隠した動物駒で戦う、登録制のオンラインボードゲームです。ランクマッチ、フレンドマッチ、10段階ランク、ランキング、どんぐり交換所、28日バトルパスを備えます。

## ローカル実行

Node.js 20.19以上を使用します。

```bash
npm install
cp .env.example .env.local
npm start
```

`.env.local`へ対象Supabaseプロジェクトの`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`を設定します。ブラウザへsecret key／service role keyを置かないでください。

```bash
npm test
npm run build
```

## Supabase

対象プロジェクトは`lxpqnmqfpwrnckoyxiab`です。初回セットアップでは次を行います。

1. Supabase CLIで対象プロジェクトへログイン・リンクする。
2. `supabase/migrations`のマイグレーションを適用する。
3. Google AuthとメールOTPを有効化し、本番URLとローカルURLをRedirect URLsへ登録する。
4. Edge Functionsをデプロイする。
5. `APP_ORIGIN`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`をFunction secretsへ登録する。
6. Stripe Webhookを`/functions/v1/stripe-webhook`へ接続する。
7. Security／Performance Advisorsを確認する。

公開テーブルにはRLSを設定し、完全な対局状態は`private.match_states`へ保存します。ランク・報酬・購入権利はクライアントのローカル保存を信用せず、DB関数とEdge Functionsで確定します。

## 商用対戦仕様

- 全対戦でGoogleまたはメールOTPによるアカウント登録が必要です。
- ランクマッチはカジュアル盤固定です。レート差±100から検索し、5秒ごとに範囲を拡大、20秒後に同ランクCPUへ切り替えます。
- ランクは小動物III／II／I、森の動物III／II／I、猛獣III／II／I、神獣の10段階です。
- 対人戦はElo `K=32`、CPU戦は`K=16`、最低レートは1000です。
- CPUは10ランクすべてで非公開の敵駒を直接参照しません。
- フレンドマッチはCasual／Classicを選択でき、レート変動はありません。
- ランク対人勝利30、CPU勝利15、フレンド勝利10どんぐりです。フレンド報酬は1日3勝までです。
- ショップ商品は駒スキン、盤面テーマ、保存配置枠のみで、駒能力には影響しません。
- シーズンは28日。終了時のレートは`1000 + (旧レート - 1000) × 0.5`へリセットします。

## ゲームルール

- Casualは4×7・11駒、Classicは8×9・31駒です。
- 本陣（巣）は横2列分を使う1つの論理マスで、駒を1つ配置できます。
- ハチの巣（罠）は本陣と突入口へ配置できません。
- 移動可能な駒は敵本陣へ入れますが、少佐以上が入った場合だけ勝利します。
- 敵駒は戦闘後も伏せたまま表示し、勝敗結果だけを公開します。

## Vercel

Vercelは`npm run build`を実行し、`dist`を配信します。次の環境変数をProduction／Previewへ設定します。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Supabase AuthのSite URLとRedirect URLsにもVercel本番・Preview URLを登録してください。
