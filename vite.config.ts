import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      // ledger.htmlはmanifestのどのスロット（popup/options等）からも参照しない
      // 独自の内部ページ（chrome.tabs.create経由でのみ開く）ため、crxjsが
      // 自動検出できない。ビルド対象として明示的に指定する。
      input: {
        ledger: "src/ledger/index.html",
      },
    },
  },
});
