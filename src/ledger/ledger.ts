import { getBytesInUse, loadAllEntries, SOFT_LIMIT_BYTES } from "../shared/storage";
import { entriesToCsv, entriesToJson, exportFileName } from "../shared/csv";
import type { Request, Response } from "../shared/messages";
import type { LedgerEntry } from "../shared/types";

const listEl = document.getElementById("entry-list") as HTMLTableSectionElement;
const countEl = document.getElementById("count") as HTMLElement;
const usageEl = document.getElementById("usage") as HTMLElement;
const errorEl = document.getElementById("error") as HTMLElement;
const emptyStateEl = document.getElementById("empty-state") as HTMLElement;
const deleteAllButton = document.getElementById("delete-all") as HTMLButtonElement;
const exportCsvButton = document.getElementById("export-csv") as HTMLButtonElement;
const exportJsonButton = document.getElementById("export-json") as HTMLButtonElement;

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError(): void {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

async function sendRequestSafely(request: Request): Promise<Response> {
  try {
    return (await chrome.runtime.sendMessage(request)) as Response;
  } catch {
    return { type: "MUTATION_RESULT", ok: false, error: "message-failed" };
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function renderEntries(entries: LedgerEntry[]): void {
  listEl.innerHTML = "";
  emptyStateEl.hidden = entries.length > 0;

  for (const entry of entries) {
    const row = document.createElement("tr");

    const dateCell = document.createElement("td");
    dateCell.textContent = new Date(entry.capturedAt).toLocaleString();
    row.appendChild(dateCell);

    const titleCell = document.createElement("td");
    titleCell.textContent = entry.title || "(タイトルなし)";
    row.appendChild(titleCell);

    const urlCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = entry.url;
    link.textContent = entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    urlCell.appendChild(link);
    row.appendChild(urlCell);

    const selectionCell = document.createElement("td");
    if (entry.selectedText) {
      const excerpt = entry.selectedText.slice(0, 120);
      const suffix = entry.selectedText.length > 120 || entry.selectionTruncated ? "…" : "";
      selectionCell.textContent = excerpt + suffix;
    } else {
      selectionCell.textContent = "(選択なし)";
    }
    row.appendChild(selectionCell);

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => {
      void handleDelete(entry.id);
    });
    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);

    listEl.appendChild(row);
  }
}

async function refresh(): Promise<void> {
  clearError();
  const [entries, bytesInUse] = await Promise.all([loadAllEntries(), getBytesInUse()]);
  countEl.textContent = String(entries.length);
  usageEl.textContent = `${formatBytes(bytesInUse)} / ${formatBytes(SOFT_LIMIT_BYTES)}`;
  renderEntries(entries);
}

async function handleDelete(id: string): Promise<void> {
  const response = await sendRequestSafely({ type: "DELETE_ENTRY", id });
  if (!response.ok) {
    showError("削除に失敗しました。もう一度お試しください。");
    return;
  }
  await refresh();
}

// chrome.downloads.download()の拒否を呼び出し元へ伝播させるため、
// Promiseを返し切る（voidで握りつぶさない。Stage5実装レビューの指摘）。
async function downloadText(content: string, filename: string, mimeType: string): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

deleteAllButton.addEventListener("click", () => {
  void (async () => {
    const confirmed = window.confirm("すべてのエントリを削除します。よろしいですか？");
    if (!confirmed) return;
    const response = await sendRequestSafely({ type: "DELETE_ALL" });
    if (!response.ok) {
      showError("全件削除に失敗しました。");
      return;
    }
    await refresh();
  })();
});

exportCsvButton.addEventListener("click", () => {
  void (async () => {
    const entries = await loadAllEntries();
    await downloadText(entriesToCsv(entries), exportFileName("csv"), "text/csv;charset=utf-8");
  })().catch(() => showError("CSVエクスポートに失敗しました。"));
});

exportJsonButton.addEventListener("click", () => {
  void (async () => {
    const entries = await loadAllEntries();
    await downloadText(entriesToJson(entries), exportFileName("json"), "application/json;charset=utf-8");
  })().catch(() => showError("JSONエクスポートに失敗しました。"));
});

void refresh();
