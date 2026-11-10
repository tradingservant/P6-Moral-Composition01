import {
  STORAGE_KEY,
  clearProgress,
  confirmSelfCheck,
  createMemoryStorage,
  defaultSequence,
  itemStatusLabel,
  loadProgress,
  moveLetter,
  parseSequenceCards,
  presentation,
  recordFor,
  reviseWriting,
  saveProgress,
  setDraft,
  setSequenceOrder,
  stationSummary,
  submitResponse,
  validateContent,
} from "./logic.js";

const TYPE_LABEL = {
  short_text: "短答",
  single_choice: "單選",
  sequence: "排序",
  teacher_review: "老師檢閱",
};

const state = {
  data: null,
  progress: { version: 1, items: {} },
  storage: null,
  storagePersistent: true,
  view: { name: "home" },
  resetArmed: false,
  error: "",
};

function $(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    el.append(child);
  }
  return el;
}

function text(tag, content, attrs = {}) {
  return $(tag, { ...attrs, text: content });
}

function persist() {
  try {
    saveProgress(state.storage, state.progress);
  } catch {
    state.storagePersistent = false;
  }
}

function stationById(id) {
  return state.data.stations.find((station) => station.id === id);
}

function currentItem() {
  const station = stationById(state.view.stationId);
  return station?.items[state.view.index] ?? null;
}

function openStation(stationId) {
  const station = stationById(stationId);
  const index = station.items.findIndex((item) => {
    const record = state.progress.items[item.id];
    if (!record) return true;
    if (item.type === "teacher_review") return record.phase !== "pending_teacher";
    return record.phase !== "revealed";
  });
  state.view = { name: "station", stationId, index: index === -1 ? 0 : index };
  state.resetArmed = false;
  render();
}

function render() {
  const root = document.getElementById("app");
  root.replaceChildren();
  if (state.error) {
    root.append(text("p", state.error, { class: "banner", role: "alert" }));
    return;
  }
  if (!state.storagePersistent) {
    root.append(text("p", "無法使用本機儲存。這次作答只留在目前頁面，離開後不會保留。", { class: "banner" }));
  }
  if (state.view.name === "home") renderHome(root);
  else renderStation(root);
}

function renderHome(root) {
  root.append(
    $("header", { class: "masthead" }, [
      text("p", "品德作文準備", { class: "eyebrow" }),
      text("h1", "網上五站"),
      text(
        "p",
        "每次可做一站，約 8–12 分鐘。不設倒數，不公開排名，不需帳戶。這是鞏固練習，不是英語分級測驗。",
      ),
    ]),
  );

  const list = $("section", { class: "station-list", "aria-label": "五站" });
  for (const station of state.data.stations) {
    const summary = stationSummary(station, state.progress);
    const card = $("article", { class: "station-card", "data-station": String(station.id) }, [
      text("h2", `站 ${station.id}：${station.title}`),
      text("p", station.target),
      text("p", `自動題首次答對 ${summary.firstCorrect}／${summary.autoTotal}`, { class: "stat" }),
      summary.reviewTotal
        ? text("p", `待老師核對 ${summary.pendingTeacher}／${summary.reviewTotal}`, { class: "stat" })
        : text("p", "本站沒有人工檢閱題", { class: "stat" }),
      summary.readyToReduceHints ? guidance(summary) : null,
      $("button", { type: "button", "data-action": "open-station", "data-station": String(station.id), text: "進入此站" }),
    ]);
    list.append(card);
  }
  root.append(list);
  root.append(resetControl());
  root.append(
    text(
      "p",
      "進度只存在這部裝置的瀏覽器（本機儲存）。沒有帳戶，也沒有分析追蹤。",
      { class: "footnote" },
    ),
  );
  root.dataset.view = "home";
}

function guidance() {
  return text(
    "p",
    "自動題首次正確率已達 75% 或以上，人工題亦已待老師核對（若本站有人工題）。若學生能口頭解釋兩題，可逐步減少提示；未達到則挑兩題教完，再以新句重試。不以作答時間判斷。",
    { class: "guidance" },
  );
}

function renderStation(root) {
  const station = stationById(state.view.stationId);
  const item = station.items[state.view.index];
  const record = recordFor(state.progress, item);
  const view = presentation(item, record);
  const summary = stationSummary(station, state.progress);

  root.dataset.view = "station";
  root.append(
    $("header", { class: "station-head" }, [
      $("button", { type: "button", "data-action": "home", text: "返回各站" }),
      text("p", `站 ${station.id}`, { class: "eyebrow" }),
      text("h1", station.title),
      text("p", `第 ${state.view.index + 1} 題，共 ${station.items.length} 題`),
      text("p", `自動題首次答對 ${summary.firstCorrect}／${summary.autoTotal}`, { class: "stat" }),
    ]),
  );

  const pager = $("nav", { class: "pager", "aria-label": "題目" });
  station.items.forEach((candidate, index) => {
    const label = itemStatusLabel(candidate, state.progress.items[candidate.id]);
    pager.append(
      $("button", {
        type: "button",
        "data-action": "goto",
        "data-index": String(index),
        "aria-current": index === state.view.index ? "true" : "false",
        text: `${index + 1} ${label}`,
      }),
    );
  });
  root.append(pager);

  const card = $("article", { class: "question-card", "data-item": item.id }, [
    text("p", `${TYPE_LABEL[item.type]}｜${item.id}`, { class: "meta" }),
    text("h2", item.prompt, { class: "prompt", lang: "en" }),
  ]);
  root.append(card);
  root.append(renderResponse(item, record, view));
  root.append(renderFeedback(item, record, view));

  const move = $("nav", { class: "item-nav", "aria-label": "上一題下一題" }, [
    $("button", {
      type: "button",
      "data-action": "prev",
      disabled: state.view.index === 0,
      text: "上一題",
    }),
    $("button", {
      type: "button",
      "data-action": "next",
      disabled: state.view.index === station.items.length - 1,
      text: "下一題",
    }),
  ]);
  root.append(move);
  if (summary.readyToReduceHints) root.append(guidance(summary));
  root.append(resetControl());
  const live = root.querySelector("[data-feedback-mode]");
  if (live && live.dataset.feedbackMode !== "none" && live.dataset.feedbackMode !== "answering" && live.dataset.feedbackMode !== "writing") {
    live.focus();
  }
}

function renderResponse(item, record, view) {
  if (item.type === "teacher_review") return renderTeacherForm(item, record, view);
  if (view.mode === "revealed") return document.createDocumentFragment();
  if (item.type === "short_text") return renderShortText(item, record);
  if (item.type === "single_choice") return renderChoice(item, record);
  if (item.type === "sequence") return renderSequence(item, record);
  return document.createDocumentFragment();
}

function renderShortText(item, record) {
  const input = $("input", {
    id: "answer",
    name: "answer",
    type: "text",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    lang: "en",
    value: record.draft || "",
  });
  input.addEventListener("input", () => {
    state.progress = setDraft(state.progress, item, input.value);
    persist();
  });
  const form = $("form", { class: "answer-form", "data-kind": "short_text" }, [
    $("label", { for: "answer", text: "你的英文答案" }),
    input,
    $("button", { type: "submit", text: record.phase === "hint" ? "再交一次" : "提交答案" }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value;
    if (!value.trim()) {
      showInline(form, "請先輸入答案。");
      return;
    }
    commit(item, value);
  });
  return form;
}

function renderChoice(item, record) {
  const fieldset = $("fieldset", { class: "choices" }, [text("legend", "選擇一項，然後提交")]);
  item.options.forEach((option, index) => {
    const id = `opt-${item.id}-${index}`;
    const input = $("input", { type: "radio", name: "choice", id, value: option });
    if (record.draft === option) input.checked = true;
    input.addEventListener("change", () => {
      state.progress = setDraft(state.progress, item, option);
      persist();
      form.querySelector("button[type=submit]").disabled = false;
    });
    fieldset.append($("label", { class: "choice", for: id }, [input, text("span", option, { lang: "en" })]));
  });
  const button = $("button", {
    type: "submit",
    disabled: !record.draft,
    text: record.phase === "hint" ? "再交一次" : "提交答案",
  });
  const form = $("form", { class: "answer-form", "data-kind": "single_choice" }, [fieldset, button]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = form.querySelector("input[name=choice]:checked");
    if (!selected) {
      showInline(form, "請先選定一項。");
      return;
    }
    commit(item, selected.value);
  });
  return form;
}

function renderSequence(item, record) {
  const letters = record.sequence?.length ? record.sequence.slice() : defaultSequence(item);
  const cards = parseSequenceCards(item.prompt);
  const byLetter = Object.fromEntries(cards.map((card) => [card.letter, card.text]));
  const list = $("ol", { class: "sequence", "aria-label": "排列卡片。可用上移、下移按鈕，或在卡片上按上下鍵。" });
  letters.forEach((letter, index) => {
    const card = $("li", { class: "seq-card", tabindex: "0", "data-letter": letter }, [
      text("span", letter, { class: "letter", lang: "en" }),
      text("p", byLetter[letter] || "", { class: "card-text", lang: "en" }),
      $("div", { class: "moves" }, [
        $("button", {
          type: "button",
          "data-action": "move-up",
          "data-index": String(index),
          "aria-label": `上移 ${letter}`,
          disabled: index === 0,
          text: "上移",
        }),
        $("button", {
          type: "button",
          "data-action": "move-down",
          "data-index": String(index),
          "aria-label": `下移 ${letter}`,
          disabled: index === letters.length - 1,
          text: "下移",
        }),
      ]),
    ]);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      shiftSequence(item, letters, index, event.key === "ArrowUp" ? -1 : 1);
    });
    list.append(card);
  });
  const form = $("form", { class: "answer-form", "data-kind": "sequence" }, [
    text("p", "依故事先後排好，再提交。", { class: "help" }),
    list,
    $("button", { type: "submit", text: record.phase === "hint" ? "再交一次" : "提交順序" }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    commit(item, letters);
  });
  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='move-up'], [data-action='move-down']");
    if (!button) return;
    const index = Number(button.dataset.index);
    shiftSequence(item, letters, index, button.dataset.action === "move-up" ? -1 : 1);
  });
  return form;
}

function shiftSequence(item, letters, index, direction) {
  const next = moveLetter(letters, index, direction);
  if (next.join() === letters.join()) return;
  state.progress = setSequenceOrder(state.progress, item, next);
  persist();
  const focusLetter = next[index + direction];
  render();
  document.querySelector(`.seq-card[data-letter="${focusLetter}"]`)?.focus();
}

function renderTeacherForm(item, record, view) {
  if (view.mode === "self_check") return document.createDocumentFragment();
  if (view.mode === "pending") {
    const block = $("section", { class: "writing-block" }, [
      text("h3", "你的寫作"),
      text("p", record.writing || "", { class: "writing", lang: "en" }),
      $("button", { type: "button", "data-action": "revise", text: "修改寫作" }),
    ]);
    return block;
  }
  const area = $("textarea", {
    id: "writing",
    name: "writing",
    rows: "5",
    lang: "en",
  });
  area.value = record.draft || record.writing || "";
  area.addEventListener("input", () => {
    state.progress = setDraft(state.progress, item, area.value);
    persist();
  });
  const form = $("form", { class: "answer-form", "data-kind": "teacher_review" }, [
    $("label", { for: "writing", text: "你的英文寫作" }),
    area,
    $("button", { type: "submit", text: "提交寫作" }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = submitResponse(state.progress, item, area.value);
    if (result.error === "empty") {
      showInline(form, "請先寫下你的句子。");
      return;
    }
    state.progress = result.progress;
    persist();
    render();
  });
  return form;
}

function renderFeedback(item, record, view) {
  const box = $("section", {
    class: "feedback",
    tabindex: "-1",
    "aria-live": "polite",
    "data-feedback-mode": view.mode,
    "data-mastered": view.mastered ? "true" : "false",
  });
  if (view.mode === "answering" || view.mode === "writing") return box;

  if (view.mode === "hint") {
    box.append(text("h3", "提示"));
    box.append(text("p", item.hint_zh));
    box.append(text("p", "請再試一次。重試會另外保存，不計入掌握。", { class: "help" }));
    return box;
  }

  if (view.mode === "self_check") {
    box.append(text("h3", "自行檢查"));
    box.append(text("p", "先對照檢查點看自己的句子。參考例句尚未顯示。"));
    box.append(text("h3", "你的寫作"));
    box.append(text("p", record.writing || "", { class: "writing", lang: "en" }));
    box.append(text("h3", "檢查點"));
    box.append(text("p", item.feedback_zh, { class: "checkpoint" }));
    box.append($("button", { type: "button", "data-action": "revise", text: "返回修改" }));
    const check = $("input", { type: "checkbox", id: "self-check" });
    const button = $("button", { type: "button", "data-action": "confirm-self-check", disabled: true, text: "顯示參考例句" });
    check.addEventListener("change", () => {
      button.disabled = !check.checked;
    });
    box.append($("label", { class: "choice", for: "self-check" }, [check, text("span", "我已對照檢查點自行檢查")]));
    box.append(button);
    return box;
  }

  if (view.status) box.append(text("h3", view.status, { class: "status" }));

  if (item.type === "teacher_review") {
    box.append(text("p", "系統不會把這題自動評為掌握。請老師核對。", { class: "help" }));
  }

  if (view.showAnswer) {
    box.append(text("h3", item.type === "teacher_review" ? "參考例句" : "參考答案"));
    box.append(text("p", item.answer, { class: "reference", lang: "en" }));
    if (item.type === "teacher_review" && Array.isArray(item.accepted_answers)) {
      box.append(text("h3", "其他可接受參考"));
      for (const extra of item.accepted_answers) {
        box.append(text("p", extra, { class: "reference", lang: "en" }));
      }
    }
  }

  if (view.showFeedback && view.mode !== "self_check") {
    box.append(text("h3", item.type === "teacher_review" ? "檢查點" : "說明"));
    box.append(text("p", item.feedback_zh));
  }

  if (record.firstAttempt) {
    const line = `首次作答：${formatResponse(record.firstAttempt.response)}（${record.firstAttempt.correct ? "正確" : "不正確"}）`;
    box.append(text("p", line, { class: "attempt" }));
  }
  if (record.retryAttempt) {
    const line = `重試作答：${formatResponse(record.retryAttempt.response)}（${record.retryAttempt.correct ? "正確，不計入掌握" : "不正確，不計入掌握"}）`;
    box.append(text("p", line, { class: "attempt" }));
  }
  return box;
}

function formatResponse(response) {
  return Array.isArray(response) ? response.join("-") : String(response ?? "");
}

function commit(item, response) {
  const result = submitResponse(state.progress, item, response);
  state.progress = result.progress;
  persist();
  render();
}

function showInline(form, message) {
  form.querySelector(".inline-error")?.remove();
  form.append(text("p", message, { class: "inline-error", role: "alert" }));
}

function resetControl() {
  const box = $("section", { class: "reset" });
  if (!state.resetArmed) {
    box.append($("button", { type: "button", "data-action": "reset-ask", text: "清除本機紀錄" }));
    return box;
  }
  box.append(text("p", "這會刪除這部裝置上保存的作答，不能復原。"));
  box.append($("button", { type: "button", "data-action": "reset-confirm", text: "確認清除" }));
  box.append($("button", { type: "button", "data-action": "reset-cancel", text: "取消" }));
  return box;
}

function installActions() {
  document.getElementById("app").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !document.getElementById("app").contains(button)) return;
    const action = button.dataset.action;
    if (action === "home") {
      state.view = { name: "home" };
      state.resetArmed = false;
      render();
    } else if (action === "open-station") {
      openStation(Number(button.dataset.station));
    } else if (action === "goto") {
      state.view = { ...state.view, index: Number(button.dataset.index) };
      render();
    } else if (action === "prev" && state.view.index > 0) {
      state.view = { ...state.view, index: state.view.index - 1 };
      render();
    } else if (action === "next") {
      const station = stationById(state.view.stationId);
      if (state.view.index < station.items.length - 1) {
        state.view = { ...state.view, index: state.view.index + 1 };
        render();
      }
    } else if (action === "reset-ask") {
      state.resetArmed = true;
      render();
    } else if (action === "reset-cancel") {
      state.resetArmed = false;
      render();
    } else if (action === "reset-confirm") {
      clearProgress(state.storage);
      state.progress = { version: 1, items: {} };
      state.view = { name: "home" };
      state.resetArmed = false;
      render();
    } else if (action === "confirm-self-check") {
      const item = currentItem();
      state.progress = confirmSelfCheck(state.progress, item);
      persist();
      render();
    } else if (action === "revise") {
      const item = currentItem();
      state.progress = reviseWriting(state.progress, item);
      persist();
      render();
    }
  });
}

function usableStorage() {
  try {
    const probe = `${STORAGE_KEY}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return { storage: localStorage, persistent: true };
  } catch {
    return { storage: createMemoryStorage(), persistent: false };
  }
}

async function main() {
  installActions();
  const root = document.getElementById("app");
  root.append(text("p", "正在載入題目…"));
  try {
    const response = await fetch(new URL("../data/online-stations.json", import.meta.url));
    if (!response.ok) throw new Error(String(response.status));
    state.data = await response.json();
    const errors = validateContent(state.data);
    if (errors.length) throw new Error(errors.join("；"));
    const storage = usableStorage();
    state.storage = storage.storage;
    state.storagePersistent = storage.persistent;
    state.progress = loadProgress(state.storage);
    render();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {});
    }
  } catch {
    state.error = "未能載入題目。請用網站伺服器開啟這個資料夾，不要直接點開檔案。";
    render();
  }
}

if (typeof document !== "undefined" && document.getElementById("app")) {
  main();
}
