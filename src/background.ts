import {
  addEntryIfNotDuplicate,
  deleteAllEntries,
  deleteEntry,
  getBytesInUse,
  reconcileOrphanedEntries,
  SOFT_LIMIT_BYTES,
  undoLastAdd,
} from "./shared/storage";
import { isHttpUrl } from "./shared/ledger";
import { LEDGER_PAGE_PATH } from "./shared/constants";
import type { CaptureStatus, Request, Response } from "./shared/messages";

type Badge = "✓" | "済" | "!";

// tabIdを渡さない場合、Chromeは拡張機能全体のデフォルトバッジを更新して
// しまい、操作していない他のタブにも直前の結果が表示され続ける。可能な
// 限り操作対象タブへ限定する（Stage5実装レビューでの指摘）。
function setBadge(text: Badge, tabId?: number): void {
  void chrome.action.setBadgeText(tabId === undefined ? { text } : { text, tabId });
}

async function captureFromTab(
  tab: chrome.tabs.Tab,
  source: "toolbar" | "contextMenu",
  selectionOverride?: string,
): Promise<CaptureStatus> {
  if (tab.id === undefined || tab.url === undefined || !isHttpUrl(tab.url)) {
    setBadge("!", tab.id);
    return "ineligible";
  }
  const tabId = tab.id;

  // 容量超過チェック以降の失敗（storage.local自体の拒否等）が
  // fire-and-forgetのままユーザーに伝わらないことを防ぐため、
  // 全体をtry/catchで囲みバッジへ反映する（Stage5実装レビューの指摘）。
  try {
    const bytesInUse = await getBytesInUse();
    if (bytesInUse >= SOFT_LIMIT_BYTES) {
      setBadge("!", tabId);
      return "error";
    }

    let selectedText = selectionOverride ?? "";
    if (selectionOverride === undefined) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.getSelection()?.toString() ?? "",
        });
        selectedText = results[0]?.result ?? "";
      } catch {
        selectedText = "";
      }
    }

    const result = await addEntryIfNotDuplicate({
      title: tab.title ?? "",
      url: tab.url,
      selectedText,
      source,
      now: new Date(),
    });
    setBadge(result.status === "duplicate" ? "済" : "✓", tabId);
    return result.status;
  } catch (error) {
    console.error("captureFromTab failed", error);
    setBadge("!", tabId);
    return "error";
  }
}

// ツールバーアイコンにdefault_popupを設定しているため、chrome.action.onClickedは
// 発火しない。代わりにpopup側の「追加」ボタンがCAPTURE_ACTIVE_TABメッセージを送り、
// ここでその時点のアクティブタブを取得して記録する（activeTab権限は、クリックで
// popupを開いた操作自体が「拡張機能の呼び出し」となるため、この後続処理にも及ぶ）。
async function captureActiveTab(): Promise<CaptureStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return "ineligible";
  return captureFromTab(tab, "toolbar");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-selection",
    title: "選択範囲を台帳に追加",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "open-ledger",
    title: "台帳を開く",
    contexts: ["action"],
  });
  chrome.contextMenus.create({
    id: "undo-last-add",
    title: "直前の追加を取り消す",
    contexts: ["action"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-selection") {
    if (!tab) return;
    void captureFromTab(
      { ...tab, url: info.pageUrl ?? tab.url },
      "contextMenu",
      info.selectionText ?? "",
    );
    return;
  }
  if (info.menuItemId === "open-ledger") {
    void chrome.tabs.create({ url: chrome.runtime.getURL(LEDGER_PAGE_PATH) });
    return;
  }
  if (info.menuItemId === "undo-last-add") {
    void undoLastAdd().then((result) => {
      setBadge(result.ok ? "✓" : "!", tab?.id);
    });
  }
});

async function handleRequest(request: Request): Promise<Response> {
  switch (request.type) {
    case "CAPTURE_ACTIVE_TAB":
      return { type: "CAPTURE_RESULT", status: await captureActiveTab() };
    case "DELETE_ENTRY":
      await deleteEntry(request.id);
      return { type: "MUTATION_RESULT", ok: true };
    case "DELETE_ALL":
      await deleteAllEntries();
      return { type: "MUTATION_RESULT", ok: true };
    case "UNDO_LAST_ADD": {
      const result = await undoLastAdd();
      return result.ok
        ? { type: "MUTATION_RESULT", ok: true }
        : { type: "MUTATION_RESULT", ok: false, error: "no-entry-to-undo" };
    }
    default:
      return { type: "MUTATION_RESULT", ok: false, error: "unknown-request" };
  }
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handleRequest(request)
    .then(sendResponse)
    .catch((error: unknown) => {
      console.error("handleRequest failed", error);
      sendResponse({ type: "MUTATION_RESULT", ok: false, error: "unknown" } satisfies Response);
    });
  return true;
});

// Service Workerが起動するたびに実行する（コールドスタート／再起動の両方を
// カバーするため、onStartup/onInstalledではなくトップレベルで無条件に呼ぶ）。
void reconcileOrphanedEntries();
