# AGENTS.md

- 仕様: `docs/spec.md`。迷ったら仕様に従い、仕様にない判断は README の「メモ」に書く。
- コーディネーター(Hermes / Opus 5.5)はレビュー・統合・配信のみ。実装は Claude Sonnet 5.5 サブエージェント。
- 1エージェント = 1ブランチ = 1 worktree(`../pi-kakezan-worktrees/<role>`)。main checkout はコーディネーター専用。
- TDD: ロジックは先にテストを書いて失敗を確認(RED)してから実装(GREEN)。`npm test` = `node --test`。
- 依存パッケージを追加しない。外部 CDN / 解析タグ / 外部通信を入れない。
- `git push` はしない。コミットまで。
- 子ども向けアプリ。UI 文言は自然でやさしい日本語。
