# アニマルライン / HIDDEN LINE

依存ゼロのブラウザ版プロトタイプです。ゲームロジックは `/data` 配下の JSON を正として、`src/rules.js` が移動・戦闘・勝敗を解決します。

## 実行

```bash
python3 -m http.server 8000
```

その後、ブラウザで `http://localhost:8000/` を開きます。

## テスト

```bash
npm test
```

テストでは、勝敗行列の全ペア明示、同種 DRAW、トラップ特殊ルール、カジュアル/クラシックの駒数、基本移動、トラップ相打ち処理を検証します。

## 実装メモ

- カジュアルは 10 駒、クラシックは 23 駒を各陣営に配置します。
- 敵駒は未判明なら伏せ表示、戦闘後は表向きにします。
- バトルパスはローカル進行のみで、課金処理は `purchaseHook` に分離しています。
- 画像生成ツールが利用できなかったため、現時点の `/assets` は同一トンマナの SVG プレースホルダーです。

## Vercel へのデプロイ

このリポジトリはビルド工程なしの静的サイトとしてそのまま Vercel にデプロイできます。

1. GitHub などにこのブランチを push します。
2. Vercel の **Add New Project** からリポジトリを import します。
3. Framework Preset は **Other**、Build Command は空、Output Directory は `.` のままでデプロイします。
4. 以後は接続したブランチに push すると Preview Deployment、本番ブランチに merge/push すると Production Deployment が作成されます。

CLI を使う場合は、Vercel CLI をインストールした環境で以下を実行します。

```bash
vercel --prod
```

`vercel.json` は静的配信前提で、`data/` は常に再検証、`assets/` は長期キャッシュにしています。
