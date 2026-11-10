import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const files = [
  "index.html",
  "styles.css",
  "src/app.js",
  "src/logic.js",
  "sw.js",
  "manifest.webmanifest",
  "README.md",
];

const sources = Object.fromEntries(
  await Promise.all(files.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), "utf8")])),
);

test("pages and scripts use relative paths and do not call analytics", () => {
  const banned = [
    /(?:href|src|action)\s*=\s*["']\//,
    /url\(\s*\//,
    /(?:fetch|register)\(\s*["']\//,
    /google-analytics|googletagmanager|gtag\(|facebook\.net|doubleclick/i,
    /P6-Moral-Composition01-|P6-Moral-Dictation02/,
  ];
  for (const [file, source] of Object.entries(sources)) {
    for (const pattern of banned) {
      assert.equal(pattern.test(source), false, `${file} matched ${pattern}`);
    }
  }
  assert.match(sources["index.html"], /lang="zh-Hant"/);
  assert.match(sources["index.html"], /width=device-width/);
  assert.match(sources["index.html"], /href="\.\/styles\.css"/);
  assert.match(sources["index.html"], /src="\.\/src\/app\.js"/);
  assert.match(sources["index.html"], /href="\.\/manifest\.webmanifest"/);
  assert.match(sources["src/app.js"], /new URL\("\.\.\/data\/online-stations\.json"/);
  assert.match(sources["src/app.js"], /new URL\("\.\.\/sw\.js"/);
  assert.equal(sources["src/app.js"].includes("innerHTML"), false);
  const manifest = JSON.parse(sources["manifest.webmanifest"]);
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.lang, "zh-Hant");
  for (const icon of manifest.icons) assert.equal(icon.src.startsWith("/"), false);
});

test("body text is at least 18px and question code does not embed card images", () => {
  assert.match(sources["styles.css"], /html\s*\{[^}]*font-size:\s*18px;/s);
  assert.match(sources["styles.css"], /overflow-x:\s*hidden/);
  assert.equal(/<img|emoji|background-image/i.test(sources["src/app.js"]), false);
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sources["src/app.js"]), false);
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sources["index.html"]), false);
});
