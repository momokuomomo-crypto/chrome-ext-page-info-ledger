import { describe, expect, it } from "vitest";
import { entriesToCsv, entriesToJson, exportFileName } from "../../src/shared/csv";
import type { LedgerEntry } from "../../src/shared/types";

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    schemaVersion: 1,
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "商品A",
    url: "https://example.com/item",
    selectedText: "選択した説明文",
    selectionTruncated: false,
    capturedAt: "2026-07-21T01:23:45.678Z",
    source: "toolbar",
    ...overrides,
  };
}

describe("entriesToCsv", () => {
  it("UTF-8 BOMで始まる", () => {
    const csv = entriesToCsv([makeEntry()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("CRLFで改行し、列見出しを固定順で出力する", () => {
    const csv = entriesToCsv([makeEntry()]);
    const withoutBom = csv.slice(1);
    const lines = withoutBom.split("\r\n");
    expect(lines[0]).toBe('"id","captured_at","title","url","selected_text","selection_truncated","source"');
    expect(lines[1]).toContain('"550e8400-e29b-41d4-a716-446655440000"');
  });

  it("数式インジェクション対策：=+-@で始まる文字列に'を付与する", () => {
    const csv = entriesToCsv([
      makeEntry({ title: "=SUM(A1:A9)", selectedText: "@mention -danger" }),
    ]);
    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).toContain("'@mention -danger");
  });

  it("先頭以外に=+-@を含んでいても付与しない", () => {
    const csv = entriesToCsv([makeEntry({ url: "https://example.com/@x" })]);
    expect(csv).toContain('"https://example.com/@x"');
    expect(csv).not.toContain("'https://example.com/@x");
  });

  it("タブ・CRで始まる文字列にも'を付与する", () => {
    const csv = entriesToCsv([makeEntry({ title: "\tdanger", selectedText: "\rdanger2" })]);
    expect(csv).toContain("'\tdanger");
    expect(csv).toContain("'\rdanger2");
  });

  it("先頭の空白の後に数式記号が続く場合も'を付与する", () => {
    const csv = entriesToCsv([makeEntry({ title: "  =SUM(A1:A9)" })]);
    expect(csv).toContain("'  =SUM(A1:A9)");
  });

  it("フィールド内の二重引用符をエスケープする", () => {
    const csv = entriesToCsv([makeEntry({ title: 'a"b' })]);
    expect(csv).toContain('"a""b"');
  });

  it("改行を含む選択テキストも1フィールドとして保持する", () => {
    const csv = entriesToCsv([makeEntry({ selectedText: "1行目\n2行目" })]);
    expect(csv).toContain('"1行目\n2行目"');
  });

  it("空配列でもヘッダー行のみを出力する", () => {
    const csv = entriesToCsv([]);
    expect(csv.slice(1).trim()).toBe(
      '"id","captured_at","title","url","selected_text","selection_truncated","source"',
    );
  });
});

describe("entriesToJson", () => {
  it("schemaVersion・exportedAt・entriesを含み、原文を保持する", () => {
    const exportedAt = new Date("2026-07-21T02:00:00.000Z");
    const json = entriesToJson([makeEntry({ title: "=formula" })], exportedAt);
    const parsed = JSON.parse(json) as {
      schemaVersion: number;
      exportedAt: string;
      entries: LedgerEntry[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe("2026-07-21T02:00:00.000Z");
    expect(parsed.entries[0]?.title).toBe("=formula");
  });
});

describe("exportFileName", () => {
  it("page-ledger-YYYYMMDD-HHmmss.<ext> の形式を生成する", () => {
    const now = new Date(2026, 6, 21, 9, 5, 3);
    expect(exportFileName("csv", now)).toBe("page-ledger-20260721-090503.csv");
    expect(exportFileName("json", now)).toBe("page-ledger-20260721-090503.json");
  });
});
