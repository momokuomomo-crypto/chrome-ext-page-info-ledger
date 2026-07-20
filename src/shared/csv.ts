import Papa from "papaparse";
import type { LedgerEntry } from "./types";

const FORMULA_PREFIXES = ["=", "+", "-", "@"];
const CSV_BOM = String.fromCharCode(0xfeff);

// 表計算ソフトでの数式インジェクションを防ぐ（OWASP CSV Injection対策）。
// 生の先頭文字だけでなく、タブ・CR（一部アプリで数式区切りとして解釈され得る
// 危険な先頭文字）や、先頭の空白・制御文字の直後に数式記号が続く入力も
// 対象にする（Stage5実装レビューでの指摘に基づき網羅性を強化）。
function sanitizeForSpreadsheet(value: string): string {
  const leadingWhitespaceStripped = value.replace(/^[\s\t\r]+/, "");
  const isDangerous =
    value.startsWith("\t") ||
    value.startsWith("\r") ||
    FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    FORMULA_PREFIXES.some((prefix) => leadingWhitespaceStripped.startsWith(prefix));
  return isDangerous ? `'${value}` : value;
}

const CSV_FIELDS = [
  "id",
  "captured_at",
  "title",
  "url",
  "selected_text",
  "selection_truncated",
  "source",
] as const;

export function entriesToCsv(entries: LedgerEntry[]): string {
  const rows = entries.map((entry) => ({
    id: entry.id,
    captured_at: entry.capturedAt,
    title: sanitizeForSpreadsheet(entry.title),
    url: sanitizeForSpreadsheet(entry.url),
    selected_text: sanitizeForSpreadsheet(entry.selectedText),
    selection_truncated: String(entry.selectionTruncated),
    source: entry.source,
  }));
  const csvBody = Papa.unparse(
    { fields: [...CSV_FIELDS], data: rows },
    { quotes: true, newline: "\r\n" },
  );
  return `${CSV_BOM}${csvBody}`;
}

export function entriesToJson(entries: LedgerEntry[], exportedAt: Date = new Date()): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      entries,
    },
    null,
    2,
  );
}

export function exportFileName(extension: "csv" | "json", now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `page-ledger-${stamp}.${extension}`;
}
