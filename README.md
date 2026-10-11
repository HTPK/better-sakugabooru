# Better Sakugabooru

Sakugabooru を日本語で見やすくする Chrome 拡張 (MV3)。

## 開発

```
pnpm install
pnpm test        # 単体テスト
pnpm typecheck   # 型チェック
pnpm build       # dist/ に拡張を出力
```

Chrome の `chrome://extensions` で「デベロッパー モード」を ON にし、「パッケージ化されていない拡張機能を読み込む」で `dist` フォルダを選ぶ。

仕様は `docs/plans/` を参照。
