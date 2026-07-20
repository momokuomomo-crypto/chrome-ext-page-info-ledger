# ai-build-council 実行記録：ページ情報ワンクリック台帳

- run-id: `20260721-0300-page-info-ledger`
- 対象リポジトリ: https://github.com/momokuomomo-crypto/chrome-ext-page-info-ledger
- commit: `48eaf7c`（初期実装、master push済み）
- 稟議書出典: [ai-council-output 稟議書_Chrome拡張機能アイデア.md](https://github.com/momokuomomo-crypto/ai-council-output/blob/master/chrome-extension-ideas/稟議書_Chrome拡張機能アイデア.md) A-1

## 概要

閲覧ページのタイトル・URL・選択テキストをワンクリックで台帳
（chrome.storage.local）へ記録し、CSV/JSONエクスポートできるChrome拡張機能
（Manifest V3）。ツールバークリックまたは右クリックメニューで追加、
管理ページ（src/ledger/index.html）で一覧・削除・エクスポートを行う。
`tabs`権限は使わず`activeTab`のみで完結する設計。

## 実施ステージ

Stage0（Intake）→ Stage1（Codex CLI独立設計）→ Stage2（Claude査読・凍結、
条件付き承認・2件のblocker修正）→ Stage3（議長Fable本体による実装）→
Stage4（Test Gate A：52テスト・typecheck・lint・build 全通過）→
Stage5（固定diffの独立実装レビュー：Codex CLI＋Claude Agentサブエージェント、
両者独立に同一のblocker/majorを発見）→ Stage6（指摘対応・Test Gate B：
64テスト・typecheck・lint・build 全通過）→ Stage7（commit・push）。

## Stage5で発見・修正した主な指摘

- **[blocker]** 削除処理（`deleteEntry`/`deleteAllEntries`/`undoLastAdd`）の
  途中でService Workerが停止すると、起動時reconciliationが削除済み
  エントリを「孤児」として誤って復元してしまう。両レビュワー
  （Codex CLI・Claude Agent）が独立に発見。
  → `pendingDeletionIds`による2フェーズ削除で解消。
- **[major]** 重複抑止判定（10秒以内の連打防止）が書き込みキューの外で
  行われ、ほぼ同時の2回のクリックで重複登録され得るTOCTOU競合。
  両レビュワーが独立に発見。
  → `addEntryIfNotDuplicate()`として「読み取り→判定→書き込み」を
  単一のキュー操作に統合。
- **[major]** CSV数式インジェクション対策がタブ・CR・先頭空白後の
  数式記号を見ていない。
  → サニタイズ判定を拡張。
- **[major]** 容量超過・storage失敗等がfire-and-forgetで握りつぶされ
  ユーザーに伝わらない。
  → captureFromTab全体をtry/catchで囲みバッジへ反映。
- **[minor→major指摘あり]** reconciliationが孤児復元時に既存の一覧の
  手前へ無条件連結し、新しい順という不変条件を壊す（Claude Agentが発見）。
  → 生存する全IDをcapturedAtで再ソートするよう修正。

詳細な指摘一覧・対応内容は
[.ai-build-council/runs/20260721-0300-page-info-ledger/decisions/implementation-review-decisions.md](../../.ai-build-council/runs/20260721-0300-page-info-ledger/decisions/implementation-review-decisions.md)
（ローカルのみ、.gitignore対象のためリポジトリには含まれない）を参照。

## 未解決・今後の検討事項

- テスト用storageフェイクは実際のプロセスKillを再現できないため、
  「本物のクラッシュ耐性」はE2E/手動テストの領域として残っている
  （姉妹プロジェクトvoice-tab-controllerと同様の制約）。
- Chrome Web Store公開に向けたアイコン・ストア掲載文言・プライバシー
  ポリシー・スクリーンショット等は未着手。
