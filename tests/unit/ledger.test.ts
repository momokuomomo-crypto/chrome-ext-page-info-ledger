import { describe, expect, it } from "vitest";
import {
  createEntry,
  DUPLICATE_WINDOW_MS,
  isDuplicateOfRecent,
  isHttpUrl,
  MAX_SELECTION_LENGTH,
  truncateSelection,
} from "../../src/shared/ledger";

describe("isHttpUrl", () => {
  it("http/httpsを許可する", () => {
    expect(isHttpUrl("https://example.com/")).toBe(true);
    expect(isHttpUrl("http://example.com/")).toBe(true);
  });

  it("chrome://等の内部ページを拒否する", () => {
    expect(isHttpUrl("chrome://extensions")).toBe(false);
    expect(isHttpUrl("chrome-extension://abc/page.html")).toBe(false);
    expect(isHttpUrl("file:///C:/tmp/report.pdf")).toBe(false);
  });

  it("不正なURL文字列に対して例外を投げず false を返す", () => {
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("truncateSelection", () => {
  it("上限以下ならそのまま返す", () => {
    const result = truncateSelection("短い選択テキスト");
    expect(result.selectedText).toBe("短い選択テキスト");
    expect(result.selectionTruncated).toBe(false);
  });

  it(`${MAX_SELECTION_LENGTH}文字を超える場合は切り詰めてtruncatedをtrueにする`, () => {
    const longText = "a".repeat(MAX_SELECTION_LENGTH + 500);
    const result = truncateSelection(longText);
    expect(result.selectedText).toHaveLength(MAX_SELECTION_LENGTH);
    expect(result.selectionTruncated).toBe(true);
  });

  it("ちょうど上限文字数なら切り詰めない", () => {
    const exact = "b".repeat(MAX_SELECTION_LENGTH);
    const result = truncateSelection(exact);
    expect(result.selectedText).toHaveLength(MAX_SELECTION_LENGTH);
    expect(result.selectionTruncated).toBe(false);
  });
});

describe("createEntry", () => {
  it("選択テキストがない場合は空文字で有効なエントリを作る", () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const entry = createEntry({
      title: "サンプル",
      url: "https://example.com/",
      selectedText: "",
      source: "toolbar",
      now,
    });
    expect(entry.selectedText).toBe("");
    expect(entry.selectionTruncated).toBe(false);
    expect(entry.capturedAt).toBe(now.toISOString());
    expect(entry.source).toBe("toolbar");
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("isDuplicateOfRecent", () => {
  const baseTime = new Date("2026-07-21T00:00:10.000Z");
  const recent = createEntry({
    title: "t",
    url: "https://example.com/a",
    selectedText: "選択A",
    source: "toolbar",
    now: new Date("2026-07-21T00:00:05.000Z"),
  });

  it("直近エントリが無ければ重複としない", () => {
    expect(
      isDuplicateOfRecent({ url: "https://example.com/a", selectedText: "選択A", now: baseTime }, undefined),
    ).toBe(false);
  });

  it(`URL・選択テキストが同一かつ${DUPLICATE_WINDOW_MS}ms未満なら重複とみなす`, () => {
    expect(
      isDuplicateOfRecent({ url: "https://example.com/a", selectedText: "選択A", now: baseTime }, recent),
    ).toBe(true);
  });

  it("URLが異なれば重複としない", () => {
    expect(
      isDuplicateOfRecent({ url: "https://example.com/b", selectedText: "選択A", now: baseTime }, recent),
    ).toBe(false);
  });

  it("選択テキストが異なれば重複としない", () => {
    expect(
      isDuplicateOfRecent({ url: "https://example.com/a", selectedText: "選択B", now: baseTime }, recent),
    ).toBe(false);
  });

  it(`${DUPLICATE_WINDOW_MS}ms以上経過していれば重複としない`, () => {
    const later = new Date(new Date(recent.capturedAt).getTime() + DUPLICATE_WINDOW_MS);
    expect(
      isDuplicateOfRecent({ url: "https://example.com/a", selectedText: "選択A", now: later }, recent),
    ).toBe(false);
  });
});
