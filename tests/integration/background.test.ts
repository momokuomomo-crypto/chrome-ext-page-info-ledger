import { beforeEach, describe, expect, it, vi } from "vitest";
import chrome from "sinon-chrome";
import { chromeExtra } from "../setup";
import type { Request, Response } from "../../src/shared/messages";
import { addEntryIfNotDuplicate, loadAllEntries, loadMetadata } from "../../src/shared/storage";

interface FakeTab {
  id: number;
  url: string;
  title: string;
}

interface ContextMenuInfo {
  menuItemId: string;
  selectionText?: string;
  pageUrl?: string;
}

function makeTab(overrides: Partial<FakeTab> = {}): FakeTab {
  return {
    id: 1,
    url: "https://example.com/",
    title: "Example",
    ...overrides,
  };
}

/** background.tsを新規にロードし直し、モジュールスコープの状態をリセットする（SW再起動を模す）。 */
async function loadBackgroundFresh(): Promise<void> {
  vi.resetModules();
  chrome.runtime.id = "test-extension-id";
  await import("../../src/background");
}

/** popup経由のCAPTURE_ACTIVE_TABメッセージを、指定タブがアクティブな状態で発火させる。 */
function triggerCaptureActiveTab(tab: FakeTab): Promise<Response> {
  chrome.tabs.query.resolves([tab]);
  return dispatch({ type: "CAPTURE_ACTIVE_TAB" });
}

/** captureフローを経由せず、storageへ直接1件登録してテストの前提状態を作る。 */
async function seedEntry(overrides: Partial<{ url: string; selectedText: string }> = {}): Promise<void> {
  await addEntryIfNotDuplicate({
    title: "Example",
    url: overrides.url ?? "https://example.com/",
    selectedText: overrides.selectedText ?? "",
    source: "toolbar",
    now: new Date(),
  });
}

function triggerContextMenuClicked(info: ContextMenuInfo, tab?: FakeTab): Promise<void> {
  const listener = chrome.contextMenus.onClicked.addListener.lastCall.args[0] as (
    info: ContextMenuInfo,
    tab?: FakeTab,
  ) => void;
  listener(info, tab);
  return flushMicrotasks();
}

async function dispatch(request: Request): Promise<Response> {
  const listener = chrome.runtime.onMessage.addListener.lastCall.args[0] as (
    request: Request,
    sender: unknown,
    sendResponse: (response: Response) => void,
  ) => boolean;

  return new Promise<Response>((resolve) => {
    listener(request, {}, resolve);
  });
}

// setBadge等のfire-and-forgetチェーンを待つための短いマイクロタスクフラッシュ。
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  chromeExtra.scripting.executeScript.resolves([{ result: "" }]);
  chrome.tabs.create.resolves(undefined);
  chromeExtra.action.setBadgeText.resolves(undefined);
});

describe("background: リスナー登録", () => {
  it("インポート時点で同期的にリスナーを登録する", async () => {
    await loadBackgroundFresh();
    expect(chrome.contextMenus.onClicked.addListener.called).toBe(true);
    expect(chrome.runtime.onInstalled.addListener.called).toBe(true);
    expect(chrome.runtime.onMessage.addListener.called).toBe(true);
  });

  it("インストール時に3つのcontextMenus項目を登録する", async () => {
    await loadBackgroundFresh();
    const installListener = chrome.runtime.onInstalled.addListener.lastCall.args[0] as () => void;
    installListener();

    expect(chrome.contextMenus.create.callCount).toBe(3);
    const ids = chrome.contextMenus.create.getCalls().map((call) => call.args[0].id);
    expect(ids).toEqual(["add-selection", "open-ledger", "undo-last-add"]);
  });
});

describe("background: CAPTURE_ACTIVE_TABメッセージによる追加（popupの「追加」ボタン）", () => {
  it("選択テキストありのページを追加し、バッジを✓にする", async () => {
    await loadBackgroundFresh();
    chromeExtra.scripting.executeScript.resolves([{ result: "選択されたテキスト" }]);

    const response = await triggerCaptureActiveTab(makeTab());

    expect(response).toEqual({ type: "CAPTURE_RESULT", status: "added" });
    const entries = await loadAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.selectedText).toBe("選択されたテキスト");
    expect(entries[0]?.source).toBe("toolbar");
    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "✓", tabId: 1 });
  });

  it("選択テキストが無くてもタイトル・URLのみで有効なエントリとして追加する", async () => {
    await loadBackgroundFresh();
    chromeExtra.scripting.executeScript.resolves([{ result: "" }]);

    await triggerCaptureActiveTab(makeTab());

    const entries = await loadAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.selectedText).toBe("");
  });

  it("chrome://等の対象外ページではバッジを！にし、追加しない", async () => {
    await loadBackgroundFresh();

    const response = await triggerCaptureActiveTab(makeTab({ url: "chrome://extensions" }));

    expect(response).toEqual({ type: "CAPTURE_RESULT", status: "ineligible" });
    expect(await loadAllEntries()).toEqual([]);
    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "!", tabId: 1 });
  });

  it("アクティブタブが取得できない場合はineligibleを返す", async () => {
    await loadBackgroundFresh();
    chrome.tabs.query.resolves([]);

    const response = await dispatch({ type: "CAPTURE_ACTIVE_TAB" });

    expect(response).toEqual({ type: "CAPTURE_RESULT", status: "ineligible" });
    expect(await loadAllEntries()).toEqual([]);
  });

  it("スクリプト実行が例外を投げても、タイトル・URLは保存する", async () => {
    await loadBackgroundFresh();
    chromeExtra.scripting.executeScript.rejects(new Error("Cannot access contents"));

    await triggerCaptureActiveTab(makeTab());

    const entries = await loadAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.selectedText).toBe("");
  });

  it("storage.local.set()が拒否されてもfire-and-forgetのまま握りつぶさずバッジを！にする", async () => {
    await loadBackgroundFresh();
    chromeExtra.scripting.executeScript.resolves([{ result: "" }]);
    chrome.storage.local.set.rejects(new Error("QUOTA_BYTES exceeded"));

    const response = await triggerCaptureActiveTab(makeTab());

    expect(response).toEqual({ type: "CAPTURE_RESULT", status: "error" });
    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "!", tabId: 1 });
  });

  it("10秒以内に同一URL・同一選択テキストで再登録すると追加せずバッジを済にする", async () => {
    await loadBackgroundFresh();
    chromeExtra.scripting.executeScript.resolves([{ result: "同じ選択" }]);

    await triggerCaptureActiveTab(makeTab());
    const response = await triggerCaptureActiveTab(makeTab());

    expect(response).toEqual({ type: "CAPTURE_RESULT", status: "duplicate" });
    const entries = await loadAllEntries();
    expect(entries).toHaveLength(1);
    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "済", tabId: 1 });
  });
});

describe("background: contextMenus", () => {
  it("add-selectionは選択テキスト付きでcontextMenu起点として追加する", async () => {
    await loadBackgroundFresh();

    await triggerContextMenuClicked(
      { menuItemId: "add-selection", selectionText: "右クリック選択", pageUrl: "https://example.com/page" },
      makeTab({ url: "https://example.com/page" }),
    );

    const entries = await loadAllEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.selectedText).toBe("右クリック選択");
    expect(entries[0]?.source).toBe("contextMenu");
  });

  it("open-ledgerは台帳ページを新規タブで開く", async () => {
    await loadBackgroundFresh();

    await triggerContextMenuClicked({ menuItemId: "open-ledger" });

    expect(chrome.tabs.create.called).toBe(true);
  });

  it("undo-last-addは直前の追加を取り消す", async () => {
    await loadBackgroundFresh();
    await seedEntry();
    expect(await loadAllEntries()).toHaveLength(1);

    await triggerContextMenuClicked({ menuItemId: "undo-last-add" });

    expect(await loadAllEntries()).toHaveLength(0);
    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "✓" });
  });

  it("取り消す対象が無いundo-last-addはバッジを！にする", async () => {
    await loadBackgroundFresh();

    await triggerContextMenuClicked({ menuItemId: "undo-last-add" });

    expect(chromeExtra.action.setBadgeText.lastCall.args[0]).toEqual({ text: "!" });
  });
});

describe("background: メッセージ経由の削除・全件削除", () => {
  it("DELETE_ENTRYで指定エントリを削除する", async () => {
    await loadBackgroundFresh();
    await seedEntry();
    const [entry] = await loadAllEntries();

    const response = await dispatch({ type: "DELETE_ENTRY", id: entry!.id });

    expect(response).toEqual({ type: "MUTATION_RESULT", ok: true });
    expect(await loadAllEntries()).toHaveLength(0);
  });

  it("DELETE_ALLで全件削除する", async () => {
    await loadBackgroundFresh();
    await seedEntry({ url: "https://example.com/1" });
    await seedEntry({ url: "https://example.com/2" });
    expect(await loadAllEntries()).toHaveLength(2);

    const response = await dispatch({ type: "DELETE_ALL" });

    expect(response).toEqual({ type: "MUTATION_RESULT", ok: true });
    expect(await loadAllEntries()).toHaveLength(0);
  });

  it("UNDO_LAST_ADDで取り消す対象が無い場合はok: falseを返す", async () => {
    await loadBackgroundFresh();
    const response = await dispatch({ type: "UNDO_LAST_ADD" });
    expect(response).toEqual({ type: "MUTATION_RESULT", ok: false, error: "no-entry-to-undo" });
  });
});

describe("background: 起動時reconciliation", () => {
  it("読み込み時に孤児エントリを自動的に一覧へ復元する", async () => {
    const orphan = {
      schemaVersion: 1 as const,
      id: "orphan-1",
      title: "孤児",
      url: "https://example.com/orphan",
      selectedText: "",
      selectionTruncated: false,
      capturedAt: "2026-07-21T00:00:00.000Z",
      source: "toolbar" as const,
    };
    await chrome.storage.local.set({ [`ledger:entry:${orphan.id}`]: orphan });

    await loadBackgroundFresh();
    await flushMicrotasks();

    const meta = await loadMetadata();
    expect(meta.orderedIds).toContain(orphan.id);
  });
});
