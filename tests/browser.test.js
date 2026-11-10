import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";
import { STORAGE_KEY } from "../src/logic.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = "/P6-Moral-Composition01";
const data = JSON.parse(await readFile(path.join(root, "data/online-stations.json"), "utf8"));
const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

function contentType(file) {
  switch (path.extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === prefix || pathname === `${prefix}/`) pathname = `${prefix}/index.html`;
      if (!pathname.startsWith(`${prefix}/`)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const relative = pathname.slice(prefix.length);
      const file = path.normalize(path.join(root, relative));
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": contentType(file) });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function assertLayout(page) {
  const report = await page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, "u");
    const width = window.innerWidth;
    const overflow = [];
    const small = [];
    const media = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > width + 1 || rect.left < -1) {
        overflow.push({
          tag: el.tagName,
          className: String(el.className),
          text: (el.innerText || "").slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width,
        });
      }
      if (el.closest(".question-card, .feedback, .answer-form, .writing-block") && el.matches("img, svg, canvas, video, picture")) {
        media.push(el.tagName);
      }
    }
    for (const el of document.querySelectorAll("body *")) {
      const text = el.innerText || "";
      if (!text.trim()) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 18) {
        small.push({ tag: el.tagName, className: String(el.className), size, text: text.slice(0, 40) });
      }
    }
    const regions = [...document.querySelectorAll(".question-card, .feedback, .answer-form, .writing-block")];
    const emojiHits = regions.filter((region) => pattern.test(region.innerText)).map((region) => region.innerText.slice(0, 40));
    return {
      width,
      bodySize: parseFloat(getComputedStyle(document.body).fontSize),
      overflow: overflow.slice(0, 8),
      small: small.slice(0, 8),
      media,
      emojiHits,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  }, emoji.source);
  assert.equal(report.bodySize >= 18, true, `body font ${report.bodySize}`);
  assert.deepEqual(report.overflow, [], JSON.stringify(report.overflow));
  assert.deepEqual(report.small, [], JSON.stringify(report.small));
  assert.deepEqual(report.media, []);
  assert.deepEqual(report.emojiHits, []);
  assert.equal(report.scrollWidth <= report.clientWidth + 1, true, `scroll ${report.scrollWidth} > ${report.clientWidth}`);
  return report.width;
}

async function openStation(page, stationId) {
  await page.locator(`article[data-station="${stationId}"]`).getByRole("button", { name: "進入此站" }).click();
  await page.locator(".question-card").waitFor();
}

async function gotoItem(page, index) {
  await page.locator(`[data-action="goto"][data-index="${index}"]`).click();
  await page.locator(".question-card").waitFor();
}

async function orderSequence(page, target) {
  for (let place = 0; place < target.length; place += 1) {
    const letter = target[place];
    for (let guard = 0; guard < 6; guard += 1) {
      const letters = await page.locator(".seq-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.letter));
      if (letters[place] === letter) break;
      const card = page.locator(`.seq-card[data-letter="${letter}"]`);
      const index = letters.indexOf(letter);
      const name = index > place ? `上移 ${letter}` : `下移 ${letter}`;
      await card.getByRole("button", { name }).click();
    }
  }
  const finalOrder = await page.locator(".seq-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.letter));
  assert.deepEqual(finalOrder, target);
}

async function main() {
  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const external = [];
  const failed = [];
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ ...devices["iPhone 11"] });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) external.push(request.url());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`${origin}${prefix}/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "網上五站" }).waitFor();
    const width = await assertLayout(page);
    assert.equal(width, 414);
    assert.equal(await page.locator("#app").innerText().then((text) => text.includes("CONTENT_ONLY")), false);
    assert.equal(await page.locator("input[type='password'], input[type='email']").count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(failed, []);

    for (const station of data.stations) {
      await openStation(page, station.id);
      for (let index = 0; index < station.items.length; index += 1) {
        await gotoItem(page, index);
        assert.equal(await page.locator(".prompt").innerText(), station.items[index].prompt);
        assert.equal(await page.locator(".question-card img, .feedback img, .answer-form img").count(), 0);
        await assertLayout(page);
      }
      await page.getByRole("button", { name: "返回各站" }).click();
      await page.getByRole("heading", { name: "網上五站" }).waitFor();
    }

    await openStation(page, 1);
    await page.getByLabel("你的英文答案").fill("go");
    await page.getByRole("button", { name: "提交答案" }).click();
    await page.locator("[data-feedback-mode='hint']").waitFor();
    const hintText = await page.locator(".feedback").innerText();
    assert.equal(hintText.includes("提示"), true);
    assert.equal(hintText.includes("went"), false);
    assert.equal(hintText.includes("參考答案"), false);
    assert.equal(hintText.includes("Last Friday 是過去時間"), false);
    let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.deepEqual(saved.items["S1-01"].firstAttempt, { response: "go", correct: false });
    assert.equal(saved.items["S1-01"].retryAttempt, null);
    assert.equal(saved.items["S1-01"].mastered, false);

    await page.getByLabel("你的英文答案").fill("went");
    await page.getByRole("button", { name: "再交一次" }).click();
    await page.locator("[data-feedback-mode='revealed']").waitFor();
    const retryText = await page.locator(".feedback").innerText();
    assert.equal(retryText.includes("重試答對，未計入掌握"), true);
    assert.equal(retryText.includes("went"), true);
    assert.equal(retryText.includes("Last Friday 是過去時間"), true);
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(saved.items["S1-01"].firstAttempt.response, "go");
    assert.equal(saved.items["S1-01"].retryAttempt.response, "went");
    assert.equal(saved.items["S1-01"].retryAttempt.correct, true);
    assert.equal(saved.items["S1-01"].mastered, false);

    await page.getByRole("button", { name: "清除本機紀錄" }).click();
    await page.getByRole("button", { name: "確認清除" }).click();
    await page.getByRole("heading", { name: "網上五站" }).waitFor();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), null);

    await openStation(page, 1);
    await page.getByLabel("你的英文答案").fill("  WENT  ");
    await page.getByRole("button", { name: "提交答案" }).click();
    await page.locator("[data-feedback-mode='revealed']").waitFor();
    assert.equal(await page.locator(".status").innerText(), "已掌握");
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(saved.items["S1-01"].mastered, true);
    assert.equal(saved.items["S1-01"].retryAttempt, null);
    assert.equal(saved.items["S1-01"].firstAttempt.correct, true);

    await page.getByRole("button", { name: "清除本機紀錄" }).click();
    await page.getByRole("button", { name: "確認清除" }).click();
    await openStation(page, 1);
    await gotoItem(page, 5);
    await page.getByRole("radio", { name: "did" }).check();
    assert.equal(await page.locator(".feedback").count() === 0 || (await page.locator(".feedback").innerText()) === "", true);
    await page.getByRole("button", { name: "提交答案" }).click();
    const choiceHint = await page.locator(".feedback").innerText();
    assert.equal(choiceHint.includes("參考答案"), false);
    assert.equal(choiceHint.includes("直接說話可用 can"), false);
    await page.getByRole("radio", { name: "can", exact: true }).check();
    await page.getByRole("button", { name: "再交一次" }).click();
    assert.equal((await page.locator(".status").innerText()).includes("未計入掌握"), true);
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(saved.items["S1-06"].mastered, false);
    assert.equal(saved.items["S1-06"].retryAttempt.correct, true);

    await page.getByRole("button", { name: "返回各站" }).click();
    await openStation(page, 5);
    await gotoItem(page, 4);
    await page.getByRole("radio", { name: "No", exact: true }).check();
    await page.getByRole("button", { name: "提交答案" }).click();
    assert.equal(await page.locator(".status").innerText(), "已掌握");
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(saved.items["S5-05"].firstAttempt.response, "No");
    assert.equal(saved.items["S5-05"].mastered, true);

    await page.getByRole("button", { name: "返回各站" }).click();
    await openStation(page, 3);
    await gotoItem(page, 7);
    const sample = data.stations[2].items[7].answer;
    const accepted = data.stations[2].items[7].accepted_answers[0];
    await page.locator("#writing").fill("Max was tired but he still checked his bag.");
    await page.getByRole("button", { name: "提交寫作" }).click();
    await page.locator("[data-feedback-mode='self_check']").waitFor();
    let teacherText = await page.locator("#app").innerText();
    assert.equal(teacherText.includes("自行檢查"), true);
    assert.equal(teacherText.includes(sample), false);
    assert.equal(teacherText.includes(accepted), false);
    assert.equal(teacherText.includes("Max was tired but he still checked his bag."), true);
    assert.equal(teacherText.includes("待老師核對"), false);
    await page.getByLabel("我已對照檢查點自行檢查").check();
    await page.getByRole("button", { name: "顯示參考例句" }).click();
    await page.locator("[data-feedback-mode='pending']").waitFor();
    teacherText = await page.locator("#app").innerText();
    assert.equal(await page.locator(".status").innerText(), "待老師核對");
    assert.equal(teacherText.includes(sample), true);
    assert.equal(teacherText.includes(accepted), true);
    assert.equal(teacherText.includes("Max was tired but he still checked his bag."), true);
    assert.equal(teacherText.includes("已掌握"), false);
    assert.equal(await page.locator("[data-mastered='true']").count(), 0);
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(saved.items["S3-08"].writing, "Max was tired but he still checked his bag.");
    assert.equal(saved.items["S3-08"].mastered, false);
    assert.equal(saved.items["S3-08"].graded, false);
    assert.equal(saved.items["S3-08"].phase, "pending_teacher");

    await page.getByRole("button", { name: "返回各站" }).click();
    await openStation(page, 4);
    await gotoItem(page, 3);
    await page.locator(".seq-card[data-letter='A']").focus();
    await page.keyboard.press("ArrowDown");
    let letters = await page.locator(".seq-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.letter));
    assert.deepEqual(letters, ["B", "A", "C", "D"]);
    await page.locator(".seq-card[data-letter='A']").focus();
    await page.keyboard.press("ArrowUp");
    letters = await page.locator(".seq-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.letter));
    assert.deepEqual(letters, ["A", "B", "C", "D"]);
    await page.getByRole("button", { name: "提交順序" }).click();
    const sequenceHint = await page.locator(".feedback").innerText();
    assert.equal(sequenceHint.includes("參考答案"), false);
    assert.equal(sequenceHint.includes("D-B-C-A"), false);
    await orderSequence(page, ["D", "B", "C", "A"]);
    await page.getByRole("button", { name: "再交一次" }).click();
    assert.equal((await page.locator(".feedback").innerText()).includes("D-B-C-A"), true);
    assert.equal((await page.locator(".status").innerText()).includes("未計入掌握"), true);
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    assert.equal(saved.items["S4-04"].firstAttempt.response, "A-B-C-D");
    assert.equal(saved.items["S4-04"].retryAttempt.response, "D-B-C-A");
    assert.equal(saved.items["S4-04"].mastered, false);
    await assertLayout(page);

    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const wide = await desktop.newPage();
    await wide.goto(`${origin}${prefix}/`, { waitUntil: "networkidle" });
    await wide.getByRole("heading", { name: "網上五站" }).waitFor();
    await assertLayout(wide);
    await desktop.close();
    await context.close();
    assert.deepEqual(failed, []);
    assert.deepEqual(external, []);
    console.log(`browser ok iphone=${width} items=40 subpath=${prefix}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
