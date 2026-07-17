/**
 * Lightweight parser smoke test (no jest).
 * Run: npx --yes tsx scripts/test-xhs-parser.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  formatXiaohongshuShareText,
  parseXiaohongshuHtml,
} from "../src/metadata/xiaohongshuHtml";

const fixture = readFileSync(
  resolve(__dirname, "../fixtures/xhs-note-snippet.html"),
  "utf8",
);

const meta = parseXiaohongshuHtml(fixture);
const share = formatXiaohongshuShareText(meta);

const checks: Array<[string, boolean]> = [
  ["title", meta.title === "为什么李白的诗里，从未提及Tokens？"],
  ["author", meta.author === "Manto冲啊💫"],
  ["body includes tokens", (meta.body ?? "").includes("从未提及过tokens")],
  ["noteId", meta.noteId === "6a58a4d80000000001003e67"],
  ["share text", !!share && share.includes("作者：Manto冲啊💫")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}

console.log("---");
console.log(share);
if (failed > 0) {
  process.exit(1);
}
