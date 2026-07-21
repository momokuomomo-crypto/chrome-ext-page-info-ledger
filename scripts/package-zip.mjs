// dist/ をChrome Web Storeアップロード用のzipにまとめる。
// 事前に `npm run build` でdist/を最新化しておくこと（`npm run package`が両方やる）。
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, "dist");
const pkg = JSON.parse(
  await (await import("node:fs/promises")).readFile(path.join(rootDir, "package.json"), "utf8"),
);
const outFile = path.join(rootDir, `${pkg.name}-v${pkg.version}.zip`);

if (!existsSync(distDir)) {
  console.error("dist/ が見つかりません。先に `npm run build` を実行してください。");
  process.exit(1);
}

const output = createWriteStream(outFile);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.pipe(output);
archive.directory(distDir, false);
await archive.finalize();

output.on("close", () => {
  console.log(`packaged: ${path.relative(rootDir, outFile)} (${archive.pointer()} bytes)`);
});
