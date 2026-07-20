import { describe, expect, it } from "vitest";
import {
  addEntry,
  addEntryIfNotDuplicate,
  deleteAllEntries,
  deleteEntry,
  getMostRecentEntry,
  loadAllEntries,
  loadMetadata,
  reconcileOrphanedEntries,
  SOFT_LIMIT_BYTES,
  undoLastAdd,
} from "../../src/shared/storage";
import { createEntry } from "../../src/shared/ledger";
import type { LedgerEntry } from "../../src/shared/types";

function makeEntry(overrides: Partial<Parameters<typeof createEntry>[0]> = {}): LedgerEntry {
  return createEntry({
    title: "タイトル",
    url: "https://example.com/",
    selectedText: "",
    source: "toolbar",
    ...overrides,
  });
}

describe("addEntry / loadAllEntries", () => {
  it("追加したエントリを新しい順で取得できる", async () => {
    const first = makeEntry({ url: "https://example.com/1" });
    const second = makeEntry({ url: "https://example.com/2" });
    await addEntry(first);
    await addEntry(second);

    const entries = await loadAllEntries();
    expect(entries.map((e) => e.url)).toEqual(["https://example.com/2", "https://example.com/1"]);
  });

  it("追加のたびにlastAddedIdを更新する", async () => {
    const first = makeEntry();
    const second = makeEntry();
    await addEntry(first);
    await addEntry(second);

    const meta = await loadMetadata();
    expect(meta.lastAddedId).toBe(second.id);
  });

  it("何もない状態では空配列を返す", async () => {
    expect(await loadAllEntries()).toEqual([]);
  });
});

describe("deleteEntry", () => {
  it("指定したエントリのみ削除し、orderedIdsから除去する", async () => {
    const first = makeEntry();
    const second = makeEntry();
    await addEntry(first);
    await addEntry(second);

    await deleteEntry(first.id);

    const entries = await loadAllEntries();
    expect(entries.map((e) => e.id)).toEqual([second.id]);
  });

  it("最新エントリを削除するとlastAddedIdが次点へ更新される", async () => {
    const first = makeEntry();
    const second = makeEntry();
    await addEntry(first);
    await addEntry(second);

    await deleteEntry(second.id);

    const meta = await loadMetadata();
    expect(meta.lastAddedId).toBe(first.id);
  });

  it("唯一のエントリを削除するとlastAddedIdはnullになる", async () => {
    const only = makeEntry();
    await addEntry(only);
    await deleteEntry(only.id);

    const meta = await loadMetadata();
    expect(meta.lastAddedId).toBeNull();
    expect(await loadAllEntries()).toEqual([]);
  });
});

describe("deleteAllEntries", () => {
  it("全エントリを削除し、metaを初期状態に戻す", async () => {
    await addEntry(makeEntry());
    await addEntry(makeEntry());

    await deleteAllEntries();

    expect(await loadAllEntries()).toEqual([]);
    const meta = await loadMetadata();
    expect(meta).toEqual({
      schemaVersion: 1,
      orderedIds: [],
      lastAddedId: null,
      pendingDeletionIds: [],
    });
  });
});

describe("undoLastAdd", () => {
  it("直前に追加したエントリを取り消す", async () => {
    const first = makeEntry();
    const second = makeEntry();
    await addEntry(first);
    await addEntry(second);

    const result = await undoLastAdd();

    expect(result.ok).toBe(true);
    const entries = await loadAllEntries();
    expect(entries.map((e) => e.id)).toEqual([first.id]);
  });

  it("取り消せる対象が無い場合はok: falseを返す", async () => {
    const result = await undoLastAdd();
    expect(result.ok).toBe(false);
  });

  it("取り消し後に再度取り消すと『取り消せる項目なし』相当になる", async () => {
    const only = makeEntry();
    await addEntry(only);
    await undoLastAdd();

    const second = await undoLastAdd();
    expect(second.ok).toBe(false);
  });
});

describe("getMostRecentEntry", () => {
  it("lastAddedIdに対応するエントリを返す", async () => {
    const first = makeEntry();
    await addEntry(first);
    const recent = await getMostRecentEntry();
    expect(recent?.id).toBe(first.id);
  });

  it("何も無ければundefinedを返す", async () => {
    expect(await getMostRecentEntry()).toBeUndefined();
  });
});

describe("reconcileOrphanedEntries", () => {
  it("metaに未参照の孤児エントリを一覧へ復元する", async () => {
    // addEntryを経由せず、entry本体だけを直接書き込んで孤児状態を再現する
    // （SW再起動によりmeta更新前に中断したケースを模す）。
    const orphan = makeEntry({ url: "https://example.com/orphan" });
    await chrome.storage.local.set({ [`ledger:entry:${orphan.id}`]: orphan });

    await reconcileOrphanedEntries();

    const entries = await loadAllEntries();
    expect(entries.map((e) => e.id)).toContain(orphan.id);
    const meta = await loadMetadata();
    expect(meta.lastAddedId).toBe(orphan.id);
  });

  it("実データが欠損した壊れた参照をorderedIdsから除去する", async () => {
    const ghostId = "ghost-id-not-stored";
    await chrome.storage.local.set({
      "ledger:meta": {
        schemaVersion: 1,
        orderedIds: [ghostId],
        lastAddedId: ghostId,
        pendingDeletionIds: [],
      },
    });

    await reconcileOrphanedEntries();

    const meta = await loadMetadata();
    expect(meta.orderedIds).not.toContain(ghostId);
    expect(meta.lastAddedId).toBeNull();
  });

  it("整合済みの状態では何も変更しない", async () => {
    const entry = makeEntry();
    await addEntry(entry);

    await reconcileOrphanedEntries();

    const meta = await loadMetadata();
    expect(meta.orderedIds).toEqual([entry.id]);
    expect(meta.lastAddedId).toBe(entry.id);
  });

  it("削除フェーズ1完了・フェーズ2未完了で中断したentryは孤児として復元せず物理削除する", async () => {
    // deleteEntry()のフェーズ1（meta更新：orderedIdsから除去し
    // pendingDeletionIdsへ記録）は完了したが、フェーズ2（entry本体の物理削除）
    // の前でService Workerが停止した状態を再現する。
    const survivor = makeEntry({ url: "https://example.com/survivor" });
    await addEntry(survivor);
    const deletedMidway = makeEntry({ url: "https://example.com/deleted-midway" });
    await chrome.storage.local.set({
      [`ledger:entry:${deletedMidway.id}`]: deletedMidway,
      "ledger:meta": {
        schemaVersion: 1,
        orderedIds: [survivor.id],
        lastAddedId: survivor.id,
        pendingDeletionIds: [deletedMidway.id],
      },
    });

    await reconcileOrphanedEntries();

    const entries = await loadAllEntries();
    expect(entries.map((e) => e.id)).toEqual([survivor.id]);
    expect(entries.map((e) => e.id)).not.toContain(deletedMidway.id);

    const raw = await chrome.storage.local.get(`ledger:entry:${deletedMidway.id}`);
    expect(raw[`ledger:entry:${deletedMidway.id}`]).toBeUndefined();

    const meta = await loadMetadata();
    expect(meta.pendingDeletionIds).toEqual([]);
  });

  it("orderedIdsの重複IDを除去する", async () => {
    const entry = makeEntry();
    await addEntry(entry);
    await chrome.storage.local.set({
      "ledger:meta": {
        schemaVersion: 1,
        orderedIds: [entry.id, entry.id],
        lastAddedId: entry.id,
        pendingDeletionIds: [],
      },
    });

    await reconcileOrphanedEntries();

    const meta = await loadMetadata();
    expect(meta.orderedIds).toEqual([entry.id]);
  });

  it("lastAddedIdがorderedIds[0]と矛盾していても常に再計算する", async () => {
    const first = makeEntry();
    const second = makeEntry();
    await addEntry(first);
    await addEntry(second);
    await chrome.storage.local.set({
      "ledger:meta": {
        schemaVersion: 1,
        orderedIds: [second.id, first.id],
        lastAddedId: first.id, // 本来はsecond.idであるべき矛盾した値
        pendingDeletionIds: [],
      },
    });

    await reconcileOrphanedEntries();

    const meta = await loadMetadata();
    expect(meta.lastAddedId).toBe(second.id);
  });

  it("復元する孤児は既存エントリの手前に無条件挿入せず、capturedAtで正しく並び替える", async () => {
    const newerValid = makeEntry({
      url: "https://example.com/newer",
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    await addEntry(newerValid);

    // addEntryを経由せず、meta未参照のまま古い日時のentryだけを直接書き込み、
    // 「新しいentryの後に登録されたが孤児化した、より古い」状態を再現する。
    const olderOrphan = makeEntry({
      url: "https://example.com/older-orphan",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await chrome.storage.local.set({ [`ledger:entry:${olderOrphan.id}`]: olderOrphan });

    await reconcileOrphanedEntries();

    const entries = await loadAllEntries();
    expect(entries.map((e) => e.id)).toEqual([newerValid.id, olderOrphan.id]);
  });

  it("キーが指すIDとentry内部のidが一致しない破損レコードを物理削除する", async () => {
    const corrupted = makeEntry();
    await chrome.storage.local.set({
      "ledger:entry:different-key-id": { ...corrupted, id: corrupted.id },
    });

    await reconcileOrphanedEntries();

    const entries = await loadAllEntries();
    expect(entries).toEqual([]);
    const raw = await chrome.storage.local.get("ledger:entry:different-key-id");
    expect(raw["ledger:entry:different-key-id"]).toBeUndefined();
  });
});

describe("addEntryIfNotDuplicate", () => {
  it("重複でなければ追加しstatus: addedを返す", async () => {
    const result = await addEntryIfNotDuplicate({
      title: "t",
      url: "https://example.com/",
      selectedText: "",
      source: "toolbar",
      now: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(result.status).toBe("added");
    expect(await loadAllEntries()).toHaveLength(1);
  });

  it("10秒以内の同一URL・同一選択テキストはstatus: duplicateを返し追加しない", async () => {
    await addEntryIfNotDuplicate({
      title: "t",
      url: "https://example.com/",
      selectedText: "同じ選択",
      source: "toolbar",
      now: new Date("2026-07-21T00:00:00.000Z"),
    });

    const result = await addEntryIfNotDuplicate({
      title: "t",
      url: "https://example.com/",
      selectedText: "同じ選択",
      source: "toolbar",
      now: new Date("2026-07-21T00:00:05.000Z"),
    });

    expect(result.status).toBe("duplicate");
    expect(await loadAllEntries()).toHaveLength(1);
  });

  it("10,000文字超の同一選択テキストも切り詰め後の値で重複判定する", async () => {
    const longText = "a".repeat(10_500);
    await addEntryIfNotDuplicate({
      title: "t",
      url: "https://example.com/",
      selectedText: longText,
      source: "toolbar",
      now: new Date("2026-07-21T00:00:00.000Z"),
    });

    const result = await addEntryIfNotDuplicate({
      title: "t",
      url: "https://example.com/",
      selectedText: longText,
      source: "toolbar",
      now: new Date("2026-07-21T00:00:05.000Z"),
    });

    expect(result.status).toBe("duplicate");
    expect(await loadAllEntries()).toHaveLength(1);
  });

  it("ほぼ同時の2回の呼び出しでも重複登録しない（読み取り→判定→書き込みが単一キュー操作のため）", async () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const params = {
      title: "t",
      url: "https://example.com/",
      selectedText: "同時押し",
      source: "toolbar" as const,
      now,
    };

    const [first, second] = await Promise.all([
      addEntryIfNotDuplicate(params),
      addEntryIfNotDuplicate(params),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["added", "duplicate"]);
    expect(await loadAllEntries()).toHaveLength(1);
  });
});

describe("SOFT_LIMIT_BYTES", () => {
  it("4MiBに設定されている", () => {
    expect(SOFT_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  });
});
