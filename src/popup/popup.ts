import { LEDGER_PAGE_PATH } from "../shared/constants";
import { loadAllEntries } from "../shared/storage";
import type { CaptureStatus, Request, Response } from "../shared/messages";

const addButton = document.getElementById("add") as HTMLButtonElement;
const undoButton = document.getElementById("undo") as HTMLButtonElement;
const openLedgerButton = document.getElementById("open-ledger") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;
const countEl = document.getElementById("count") as HTMLElement;

const CAPTURE_STATUS_MESSAGES: Record<CaptureStatus, string> = {
  added: "台帳に追加しました。",
  duplicate: "直前の記録と同じ内容のため、追加しませんでした。",
  ineligible: "このページ（chrome://等）は対象外です。",
  error: "追加に失敗しました。",
};

async function sendRequest(request: Request): Promise<Response> {
  return (await chrome.runtime.sendMessage(request)) as Response;
}

function showStatus(text: string): void {
  statusEl.textContent = text;
}

async function refreshCount(): Promise<void> {
  const entries = await loadAllEntries();
  countEl.textContent = String(entries.length);
}

addButton.addEventListener("click", () => {
  addButton.disabled = true;
  void sendRequest({ type: "CAPTURE_ACTIVE_TAB" })
    .then(async (response) => {
      if (response.type === "CAPTURE_RESULT") {
        showStatus(CAPTURE_STATUS_MESSAGES[response.status]);
      }
      await refreshCount();
    })
    .catch(() => showStatus("追加に失敗しました。"))
    .finally(() => {
      addButton.disabled = false;
    });
});

undoButton.addEventListener("click", () => {
  void sendRequest({ type: "UNDO_LAST_ADD" }).then(async (response) => {
    if (response.type === "MUTATION_RESULT") {
      showStatus(response.ok ? "直前の追加を取り消しました。" : "取り消せる記録がありません。");
    }
    await refreshCount();
  });
});

openLedgerButton.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL(LEDGER_PAGE_PATH) });
});

void refreshCount();
