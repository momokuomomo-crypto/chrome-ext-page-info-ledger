import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "ページ情報ワンクリック台帳",
  description:
    "ページのタイトル・URL・選択テキストをワンクリックで台帳に記録します。",
  version: pkg.version,
  permissions: ["activeTab", "scripting", "storage", "contextMenus", "downloads"],
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
});
