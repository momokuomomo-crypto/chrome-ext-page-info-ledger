import type { LedgerEntry, LedgerMetadata } from "./types";
import { createEntry, isDuplicateOfRecent, truncateSelection } from "./ledger";

const META_KEY = "ledger:meta";
const ENTRY_PREFIX = "ledger:entry:";
const entryKey = (id: string): string => `${ENTRY_PREFIX}${id}`;

export const SOFT_LIMIT_BYTES = 4 * 1024 * 1024;

function defaultMetadata(): LedgerMetadata {
  return { schemaVersion: 1, orderedIds: [], lastAddedId: null, pendingDeletionIds: [] };
}

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export async function loadMetadata(): Promise<LedgerMetadata> {
  const result = await chrome.storage.local.get(META_KEY);
  const meta = result[META_KEY] as LedgerMetadata | undefined;
  return meta ?? defaultMetadata();
}

async function saveMetadata(meta: LedgerMetadata): Promise<void> {
  await chrome.storage.local.set({ [META_KEY]: meta });
}

export async function loadEntry(id: string): Promise<LedgerEntry | undefined> {
  const result = await chrome.storage.local.get(entryKey(id));
  return result[entryKey(id)] as LedgerEntry | undefined;
}

export async function loadAllEntries(): Promise<LedgerEntry[]> {
  const meta = await loadMetadata();
  if (meta.orderedIds.length === 0) return [];
  const keys = meta.orderedIds.map(entryKey);
  const result = await chrome.storage.local.get(keys);
  return meta.orderedIds
    .map((id) => result[entryKey(id)] as LedgerEntry | undefined)
    .filter((entry): entry is LedgerEntry => entry !== undefined);
}

export async function getMostRecentEntry(): Promise<LedgerEntry | undefined> {
  const meta = await loadMetadata();
  if (meta.lastAddedId === null) return undefined;
  return loadEntry(meta.lastAddedId);
}

export async function getBytesInUse(): Promise<number> {
  return chrome.storage.local.getBytesInUse(null);
}

// 直列化キュー：同一Service Worker内でのadd/delete/重複判定の競合を防ぐ。
// Service Worker再起動をまたぐ整合性は、状態をchrome.storageのみに置き
// インメモリのキュー自体には依存しないことで担保する
// （キューは「今稼働中のイベントループ内」の競合防止にのみ使う）。
//
// 注意：ここでenqueueWriteされる関数の内部から、他のenqueueWrite対象の
// 公開関数（addEntry/deleteEntry等）を呼び出してはならない（同じキューに
// 対して自分自身の完了を待つ形になりデッドロックする）。共有ロジックは
// *Core関数として素の非同期関数に切り出し、公開関数側でのみenqueueWriteする。
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// entry本体とmeta更新を単一のchrome.storage.local.set()呼び出しにまとめる。
// これはChrome Storage APIが保証する原子性ではなく（複数キーの一括setが
// クラッシュ耐性のあるトランザクションである契約はない）、あくまで
// 2回の別呼び出しに比べて不整合の窓を縮小するベストエフォートの対策
// （Stage5実装レビューでの指摘に基づき、過大な保証表現を修正）。
async function addEntryCore(entry: LedgerEntry, meta: LedgerMetadata): Promise<void> {
  const nextMeta: LedgerMetadata = {
    schemaVersion: 1,
    orderedIds: [entry.id, ...meta.orderedIds],
    lastAddedId: entry.id,
    pendingDeletionIds: meta.pendingDeletionIds,
  };
  await chrome.storage.local.set({
    [entryKey(entry.id)]: entry,
    [META_KEY]: nextMeta,
  });
}

export function addEntry(entry: LedgerEntry): Promise<void> {
  return enqueueWrite(async () => {
    const meta = await loadMetadata();
    await addEntryCore(entry, meta);
  });
}

export type CaptureResult =
  | { status: "added"; entry: LedgerEntry }
  | { status: "duplicate" };

// 「直近エントリの読み取り→重複判定→追加」を単一のキュー操作として実行する。
// これらを分離していると、ほぼ同時に発生した2回のツールバークリックが
// どちらも同じ旧metaを読んで「重複ではない」と判定してしまい、直列化された
// 書き込み自体は競合しなくても重複登録され得る（Stage5実装レビューの指摘）。
export function addEntryIfNotDuplicate(params: {
  title: string;
  url: string;
  selectedText: string;
  source: "toolbar" | "contextMenu";
  now: Date;
}): Promise<CaptureResult> {
  return enqueueWrite(async () => {
    const meta = await loadMetadata();
    const recent = meta.lastAddedId !== null ? await loadEntry(meta.lastAddedId) : undefined;

    // 保存時に切り詰められるselectedTextと同じ値で重複判定する
    // （切り詰め前の値で比較すると10,000文字超の選択が一致しなくなるため）。
    const { selectedText: truncatedSelectedText } = truncateSelection(params.selectedText);

    if (
      isDuplicateOfRecent(
        { url: params.url, selectedText: truncatedSelectedText, now: params.now },
        recent,
      )
    ) {
      return { status: "duplicate" };
    }

    const entry = createEntry({
      title: params.title,
      url: params.url,
      selectedText: params.selectedText,
      source: params.source,
      now: params.now,
    });
    await addEntryCore(entry, meta);
    return { status: "added", entry };
  });
}

// 削除の共有ロジック（enqueueWriteされない素の関数）。
// 2フェーズで行う：
//   フェーズ1：meta更新のみ（orderedIdsから除去し、pendingDeletionIdsへ記録）。
//     ここで中断しても一覧からは既に消えている。
//   フェーズ2：entry本体を物理削除し、pendingDeletionIdsから除去する。
// フェーズ1とフェーズ2の間で中断した場合、起動時reconciliationが
// pendingDeletionIdsを見て物理削除を完了させる（「孤児として復元」
// してしまわないようにするため。Stage5実装レビューでのblocker指摘に対応）。
async function deleteEntriesByIdCore(idsToDelete: string[]): Promise<void> {
  if (idsToDelete.length === 0) return;
  const meta = await loadMetadata();
  const toDeleteSet = new Set(idsToDelete);
  const orderedIds = meta.orderedIds.filter((id) => !toDeleteSet.has(id));
  const pendingDeletionIds = dedupePreserveOrder([...meta.pendingDeletionIds, ...idsToDelete]);

  await saveMetadata({
    schemaVersion: 1,
    orderedIds,
    lastAddedId: orderedIds[0] ?? null,
    pendingDeletionIds,
  });

  await chrome.storage.local.remove(idsToDelete.map(entryKey));

  await saveMetadata({
    schemaVersion: 1,
    orderedIds,
    lastAddedId: orderedIds[0] ?? null,
    pendingDeletionIds: pendingDeletionIds.filter((id) => !toDeleteSet.has(id)),
  });
}

export function deleteEntry(id: string): Promise<void> {
  return enqueueWrite(() => deleteEntriesByIdCore([id]));
}

export function deleteAllEntries(): Promise<void> {
  return enqueueWrite(async () => {
    const meta = await loadMetadata();
    await deleteEntriesByIdCore(meta.orderedIds);
  });
}

export function undoLastAdd(): Promise<{ ok: boolean }> {
  return enqueueWrite(async () => {
    const meta = await loadMetadata();
    if (meta.lastAddedId === null) {
      return { ok: false };
    }
    await deleteEntriesByIdCore([meta.lastAddedId]);
    return { ok: true };
  });
}

// Service Worker起動のたびに実行する自己修復処理。
// - 削除処理の途中（pendingDeletionIdsに残っている）で中断したentry：
//   孤児として復元せず、物理削除を完了させる。
// - 上記以外で、metaに未参照だが実データが存在するentry：一覧へ復元する
//   （個人の記録用データを黙って失わないことを優先する）。
// - metaが参照しているが実データが欠損しているID：orderedIdsから除去する。
// - キーが指すIDとentry内部のidが一致しない破損レコード：復元対象にせず
//   物理削除する。
// - lastAddedId・orderedIdsの重複は常に再計算・正規化する
//   （保存済みの値を信用しない）。
export function reconcileOrphanedEntries(): Promise<void> {
  return enqueueWrite(async () => {
    const all = await chrome.storage.local.get(null);
    const meta = (all[META_KEY] as LedgerMetadata | undefined) ?? defaultMetadata();
    const pendingDeletionIds = meta.pendingDeletionIds ?? [];

    const entryIdsInStorage = new Set<string>();
    const validEntriesByid = new Map<string, LedgerEntry>();
    for (const key of Object.keys(all)) {
      if (!key.startsWith(ENTRY_PREFIX)) continue;
      const idFromKey = key.slice(ENTRY_PREFIX.length);
      const entry = all[key] as LedgerEntry | undefined;
      if (!entry || entry.id !== idFromKey) {
        // キーとentry.idが一致しない破損レコードは信用せず物理削除する。
        await chrome.storage.local.remove(key);
        continue;
      }
      entryIdsInStorage.add(idFromKey);
      validEntriesByid.set(idFromKey, entry);
    }

    // 削除フェーズ1（meta更新）は完了したがフェーズ2（物理削除）が
    // 未完了だったentryを、ここで物理削除して完了させる。
    const stillPendingDeletion = pendingDeletionIds.filter((id) => entryIdsInStorage.has(id));
    if (stillPendingDeletion.length > 0) {
      await chrome.storage.local.remove(stillPendingDeletion.map(entryKey));
      for (const id of stillPendingDeletion) entryIdsInStorage.delete(id);
    }

    const referencedIds = new Set(meta.orderedIds);
    const missingFromMeta = [...entryIdsInStorage].filter(
      (id) => !referencedIds.has(id) && !pendingDeletionIds.includes(id),
    );
    const cleanedOrderedIds = dedupePreserveOrder(
      meta.orderedIds.filter((id) => entryIdsInStorage.has(id)),
    );

    // 復元する孤児（missingFromMeta）を既存のorderedIdsの手前へ無条件で
    // 連結すると、孤児の実際のcapturedAtが既存エントリより古い場合に
    // 「新しい順」という一覧の不変条件が崩れる（Stage5実装レビューでの
    // 指摘）。生存する全IDをcapturedAtで再ソートし直す。
    const orderedIds = [...missingFromMeta, ...cleanedOrderedIds]
      .map((id) => validEntriesByid.get(id))
      .filter((entry): entry is LedgerEntry => entry !== undefined)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .map((entry) => entry.id);

    await saveMetadata({
      schemaVersion: 1,
      orderedIds,
      lastAddedId: orderedIds[0] ?? null,
      pendingDeletionIds: [],
    });
  });
}
