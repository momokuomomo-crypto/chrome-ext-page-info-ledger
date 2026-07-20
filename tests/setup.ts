import chrome from "sinon-chrome";
import sinon from "sinon";
import { afterEach, beforeEach } from "vitest";

// sinon-chromeが提供するグローバルchrome APIフェイクを、テスト実行環境へ注入する。
(globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;

// sinon-chrome(v3.0.1)はManifest V3で追加されたchrome.action / chrome.scripting
// を持たない（browserAction/pageActionのみ）。本拡張機能はこの2つを直接使うため、
// 手書きのsinonスタブを追加する。chrome.flush()の対象外なので、履歴・振る舞いの
// リセットはbeforeEachで個別に行う。
export interface ActionAndScriptingExtras {
  action: {
    onClicked: { addListener: sinon.SinonStub };
    setBadgeText: sinon.SinonStub;
  };
  scripting: {
    executeScript: sinon.SinonStub;
  };
}

export const chromeExtra = chrome as unknown as ActionAndScriptingExtras;
chromeExtra.action = {
  onClicked: { addListener: sinon.stub() },
  setBadgeText: sinon.stub(),
};
chromeExtra.scripting = {
  executeScript: sinon.stub(),
};

// sinon-chromeのchrome.storage.local.get/set/remove/getBytesInUseは
// 呼び出し記録のみのsinonスタブであり、実際の永続化を模倣しない。
// addEntry/deleteEntry等の実際の読み書きロジックを検証するには実データを
// 保持する簡易フェイクが必要なため、各メソッドの実装をcallsFakeで差し替える
// （chrome.storage.localというオブジェクト自体はgetter-only property
// のため丸ごとの再代入はできない）。
// 実際のchrome.storageは値の格納・取得時にstructured cloneを行い、
// 呼び出し元と同じオブジェクト参照を返さない。フェイクが同一参照を
// 返すと、取得値を書き換えると保存内容まで変化してしまうバグを
// 検出できないため、structuredCloneで値の独立性を模倣する
// （Stage5実装レビューでの指摘に基づく）。
function installFakeStorageLocal(): void {
  let store: Record<string, unknown> = {};

  chrome.storage.local.get.callsFake((keys?: string | string[] | null) => {
    if (keys === null || keys === undefined) {
      return Promise.resolve(structuredClone(store));
    }
    const keyList = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of keyList) {
      if (key in store) result[key] = store[key];
    }
    return Promise.resolve(structuredClone(result));
  });

  chrome.storage.local.set.callsFake((items: Record<string, unknown>) => {
    store = { ...store, ...structuredClone(items) };
    return Promise.resolve();
  });

  chrome.storage.local.remove.callsFake((keys: string | string[]) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) delete store[key];
    return Promise.resolve();
  });

  // 実際のバイト使用量に近づけるため、UTF-16コード単位数ではなく
  // UTF-8エンコード後のバイト数で近似する。
  chrome.storage.local.getBytesInUse.callsFake(() => {
    return Promise.resolve(new TextEncoder().encode(JSON.stringify(store)).length);
  });
}

beforeEach(() => {
  chrome.flush();
  installFakeStorageLocal();
  chromeExtra.action.onClicked.addListener.resetHistory();
  chromeExtra.action.setBadgeText.reset();
  chromeExtra.scripting.executeScript.reset();
});

afterEach(() => {
  chrome.flush();
});
