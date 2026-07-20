export type LedgerEntry = {
  schemaVersion: 1;
  id: string;
  title: string;
  url: string;
  selectedText: string;
  selectionTruncated: boolean;
  capturedAt: string;
  source: "toolbar" | "contextMenu";
};

export type LedgerMetadata = {
  schemaVersion: 1;
  orderedIds: string[];
  lastAddedId: string | null;
  // 削除操作の論理完了（orderedIdsから除去済み）と物理削除（entryキー本体の
  // remove）の間でService Workerが停止した場合に、次回起動時のreconciliation
  // が「未完了の追加」と誤認して復元してしまわないための削除中マーカー。
  pendingDeletionIds: string[];
};
