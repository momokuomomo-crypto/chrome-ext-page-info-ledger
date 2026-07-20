import type { LedgerEntry } from "./types";

export const MAX_SELECTION_LENGTH = 10_000;
export const DUPLICATE_WINDOW_MS = 10_000;

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function truncateSelection(text: string): {
  selectedText: string;
  selectionTruncated: boolean;
} {
  if (text.length <= MAX_SELECTION_LENGTH) {
    return { selectedText: text, selectionTruncated: false };
  }
  return { selectedText: text.slice(0, MAX_SELECTION_LENGTH), selectionTruncated: true };
}

export function createEntry(params: {
  title: string;
  url: string;
  selectedText: string;
  source: "toolbar" | "contextMenu";
  now?: Date;
}): LedgerEntry {
  const { selectedText, selectionTruncated } = truncateSelection(params.selectedText);
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: params.title,
    url: params.url,
    selectedText,
    selectionTruncated,
    capturedAt: (params.now ?? new Date()).toISOString(),
    source: params.source,
  };
}

// 重複キーはURL・選択テキストのみ（sourceは含めない）。同一ページを
// 意図的に連続記録したい稀なケースより、連打による誤登録の防止を優先する
// 判断（Stage2査読でminor指摘、議長判断でWontFix）。
export function isDuplicateOfRecent(
  candidate: { url: string; selectedText: string; now: Date },
  recent: LedgerEntry | undefined,
): boolean {
  if (!recent) return false;
  if (recent.url !== candidate.url) return false;
  if (recent.selectedText !== candidate.selectedText) return false;
  const diffMs = candidate.now.getTime() - new Date(recent.capturedAt).getTime();
  return diffMs >= 0 && diffMs < DUPLICATE_WINDOW_MS;
}
