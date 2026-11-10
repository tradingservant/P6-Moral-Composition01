import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  STORAGE_KEY,
  TEACHER_REVIEW_IDS,
  canonicalSequence,
  clearProgress,
  confirmSelfCheck,
  contentInventory,
  createMemoryStorage,
  defaultSequence,
  emptyProgress,
  findItem,
  isCorrect,
  loadProgress,
  moveLetter,
  normalizeShortText,
  parseSequenceCards,
  presentation,
  reviseWriting,
  saveProgress,
  setDraft,
  stationSummary,
  submitResponse,
  validateContent,
} from "../src/logic.js";

const data = JSON.parse(await readFile(new URL("../data/online-stations.json", import.meta.url), "utf8"));

function item(id) {
  const found = findItem(data, id);
  assert.ok(found, id);
  return found.item;
}

test("content is five stations of eight, with the six teacher-review items", () => {
  const inventory = contentInventory(data);
  assert.equal(inventory.stations, 5);
  assert.deepEqual(inventory.perStation, [8, 8, 8, 8, 8]);
  assert.equal(inventory.total, 40);
  assert.equal(inventory.auto, 34);
  assert.deepEqual(inventory.teacher, [...TEACHER_REVIEW_IDS]);
  assert.deepEqual(inventory.byType, {
    short_text: 4,
    single_choice: 29,
    sequence: 1,
    teacher_review: 6,
  });
  assert.deepEqual(validateContent(data), []);
});

test("dialogue items keep present tense inside speech", () => {
  assert.equal(item("S1-06").answer, "can");
  assert.equal(isCorrect(item("S1-06"), "can"), true);
  assert.equal(isCorrect(item("S1-06"), "did"), false);
  assert.equal(item("S5-05").answer, "No");
  assert.equal(isCorrect(item("S5-05"), "No"), true);
  assert.equal(isCorrect(item("S5-05"), "Yes"), false);
  assert.equal(isCorrect(item("S5-05"), "no"), false);
});

test("short_text trims, collapses whitespace, and case-folds without ignoring tense", () => {
  assert.equal(normalizeShortText("  WENT \n"), "went");
  assert.equal(normalizeShortText("will \t  teach"), "will teach");
  assert.equal(normalizeShortText("\u00A0went\u00A0"), "went");
  const went = item("S1-01");
  assert.equal(isCorrect(went, "  Went "), true);
  assert.equal(isCorrect(went, "go"), false);
  assert.equal(isCorrect(went, "goes"), false);
  assert.equal(isCorrect(went, "going"), false);
  assert.equal(isCorrect(went, "gone"), false);
  assert.equal(isCorrect(went, "went."), false);
  const read = item("S1-04");
  assert.equal(isCorrect(read, "READ"), true);
  assert.equal(isCorrect(read, "reads"), false);
  const synthetic = { type: "short_text", answer: "will teach" };
  assert.equal(isCorrect(synthetic, "  WILL   TEACH "), true);
  assert.equal(isCorrect(synthetic, "taught"), false);
});

test("single choice stays case-sensitive and sequence uses the authored order", () => {
  assert.equal(isCorrect(item("S3-03"), "Although"), true);
  assert.equal(isCorrect(item("S3-03"), "although"), false);
  const sequence = item("S4-04");
  const cards = parseSequenceCards(sequence.prompt);
  assert.deepEqual(cards.map((card) => card.letter), ["A", "B", "C", "D"]);
  assert.equal(cards[2].text, "A teacher showed her how to make labels.");
  assert.deepEqual(defaultSequence(sequence), ["A", "B", "C", "D"]);
  assert.equal(canonicalSequence(defaultSequence(sequence)) === canonicalSequence(sequence.answer), false);
  assert.equal(isCorrect(sequence, ["D", "B", "C", "A"]), true);
  assert.equal(isCorrect(sequence, "D - B - C - A"), true);
  assert.equal(isCorrect(sequence, ["A", "B", "C", "D"]), false);
  assert.deepEqual(moveLetter(["A", "B", "C", "D"], 0, -1), ["A", "B", "C", "D"]);
  assert.deepEqual(moveLetter(["A", "B", "C", "D"], 3, 1), ["A", "B", "C", "D"]);
  assert.deepEqual(moveLetter(["A", "B", "C", "D"], 1, -1), ["B", "A", "C", "D"]);
  assert.deepEqual(moveLetter(["A", "B", "C", "D"], 0, 1), ["B", "A", "C", "D"]);
});

test("first wrong answer stores a hint-only attempt and a separate retry that cannot master", () => {
  const question = item("S1-01");
  const first = submitResponse(emptyProgress(), question, "go");
  const firstRecord = first.progress.items["S1-01"];
  assert.equal(firstRecord.phase, "hint");
  assert.equal(firstRecord.mastered, false);
  assert.deepEqual(firstRecord.firstAttempt, { response: "go", correct: false });
  assert.equal(firstRecord.retryAttempt, null);
  assert.deepEqual(presentation(question, firstRecord), {
    mode: "hint",
    showHint: true,
    showAnswer: false,
    showFeedback: false,
    status: "請再試一次",
    mastered: false,
  });

  const retry = submitResponse(first.progress, question, "  WENT ");
  const retryRecord = retry.progress.items["S1-01"];
  assert.equal(retryRecord.phase, "revealed");
  assert.equal(retryRecord.mastered, false);
  assert.deepEqual(retryRecord.firstAttempt, { response: "go", correct: false });
  assert.deepEqual(retryRecord.retryAttempt, { response: "  WENT ", correct: true });
  assert.notEqual(retryRecord.firstAttempt, retryRecord.retryAttempt);
  const revealed = presentation(question, retryRecord);
  assert.equal(revealed.mode, "revealed");
  assert.equal(revealed.showAnswer, true);
  assert.equal(revealed.showFeedback, true);
  assert.equal(revealed.mastered, false);
  assert.equal(revealed.status, "重試答對，未計入掌握");

  const third = submitResponse(retry.progress, question, "go");
  assert.equal(third.progress, retry.progress);
});

test("a correct first answer is the only automatic mastery", () => {
  const question = item("S1-02");
  const result = submitResponse(emptyProgress(), question, " Met ");
  const record = result.progress.items["S1-02"];
  assert.equal(record.mastered, true);
  assert.equal(record.retryAttempt, null);
  assert.equal(record.firstAttempt.correct, true);
  assert.equal(record.firstAttempt.response, " Met ");
  assert.equal(presentation(question, record).status, "已掌握");
  const station = data.stations[0];
  const summary = stationSummary(station, result.progress);
  assert.equal(summary.firstCorrect, 1);
  assert.equal(summary.readyToReduceHints, false);
});

test("second wrong answer reveals the reason without mastery", () => {
  const question = item("S1-03");
  const first = submitResponse(emptyProgress(), question, "give");
  const second = submitResponse(first.progress, question, "given");
  const record = second.progress.items["S1-03"];
  assert.equal(record.mastered, false);
  assert.equal(record.retryAttempt.correct, false);
  assert.equal(presentation(question, record).status, "尚未掌握");
  assert.equal(presentation(question, record).showAnswer, true);
});

test("teacher review is never exact-string graded or auto-mastered", () => {
  for (const id of TEACHER_REVIEW_IDS) {
    const question = item(id);
    assert.equal(question.type, "teacher_review");
    assert.equal(isCorrect(question, question.answer), null);
    const exact = submitResponse(emptyProgress(), question, question.answer);
    const record = exact.progress.items[id];
    assert.equal(record.writing, question.answer);
    assert.equal(record.graded, false);
    assert.equal(record.mastered, false);
    assert.equal(record.phase, "self_check");
    assert.equal(record.firstAttempt, undefined);
    assert.equal(presentation(question, record).showAnswer, false);
    assert.equal(presentation(question, record).mastered, false);
    const pendingProgress = confirmSelfCheck(exact.progress, question);
    const pending = pendingProgress.items[id];
    assert.equal(pending.writing, question.answer);
    assert.equal(pending.selfChecked, true);
    assert.equal(pending.graded, false);
    assert.equal(pending.mastered, false);
    assert.equal(pending.phase, "pending_teacher");
    const shown = presentation(question, pending);
    assert.equal(shown.status, "待老師核對");
    assert.equal(shown.showAnswer, true);
    assert.equal(shown.mastered, false);
    const other = submitResponse(emptyProgress(), question, "A different grammatical sentence.");
    assert.equal(other.progress.items[id].mastered, false);
    assert.equal(other.progress.items[id].graded, false);
  }
});

test("teacher review keeps an accepted alternative ungraded and can be revised", () => {
  const question = item("S3-08");
  const submitted = submitResponse(emptyProgress(), question, question.accepted_answers[0]);
  assert.equal(submitted.progress.items["S3-08"].mastered, false);
  assert.equal(submitted.progress.items["S3-08"].writing, question.accepted_answers[0]);
  const pending = confirmSelfCheck(submitted.progress, question);
  const revised = reviseWriting(pending, question);
  const record = revised.items["S3-08"];
  assert.equal(record.phase, "writing");
  assert.equal(record.mastered, false);
  assert.equal(record.graded, false);
  assert.equal(record.draft, question.accepted_answers[0]);
  assert.equal(record.writing, question.accepted_answers[0]);
});

test("empty teacher writing does not create an attempt", () => {
  const question = item("S4-07");
  const result = submitResponse(emptyProgress(), question, "   \n");
  assert.equal(result.error, "empty");
  assert.deepEqual(result.progress, emptyProgress());
});

test("drafts are not mastery and station guidance uses first-try rate only", () => {
  const station = data.stations[2];
  let progress = emptyProgress();
  progress = setDraft(progress, item("S3-01"), "because");
  assert.equal(progress.items["S3-01"].mastered, false);
  assert.equal(stationSummary(station, progress).firstCorrect, 0);
  const autos = station.items.filter((entry) => entry.type !== "teacher_review");
  for (const entry of autos.slice(0, 5)) {
    progress = submitResponse(progress, entry, entry.answer).progress;
  }
  progress = submitResponse(progress, autos[5], "not-the-answer").progress;
  progress = submitResponse(progress, autos[5], autos[5].answer).progress;
  assert.equal(stationSummary(station, progress).firstCorrect, 5);
  assert.equal(stationSummary(station, progress).readyToReduceHints, false);
  progress = submitResponse(progress, autos[6], autos[6].answer).progress;
  assert.equal(stationSummary(station, progress).firstCorrect, 6);
  assert.equal(stationSummary(station, progress).readyToReduceHints, false);
  progress = confirmSelfCheck(submitResponse(progress, item("S3-08"), "Although he was tired, Max checked his bag.").progress, item("S3-08"));
  const summary = stationSummary(station, progress);
  assert.equal(summary.pendingTeacher, 1);
  assert.equal(summary.readyToReduceHints, true);
  assert.equal(summary.firstCorrectRate >= 0.75, true);
});

test("progress round-trip keeps first try and retry apart and can be cleared", () => {
  const storage = createMemoryStorage();
  let progress = submitResponse(emptyProgress(), item("S1-01"), "go").progress;
  progress = submitResponse(progress, item("S1-01"), "went").progress;
  saveProgress(storage, progress);
  const loaded = loadProgress(storage);
  assert.equal(loaded.items["S1-01"].firstAttempt.response, "go");
  assert.equal(loaded.items["S1-01"].retryAttempt.response, "went");
  assert.equal(loaded.items["S1-01"].mastered, false);
  assert.equal(STORAGE_KEY, "p6-moral-composition01.v1");
  clearProgress(storage);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  storage.setItem(STORAGE_KEY, "{");
  assert.deepEqual(loadProgress(storage), emptyProgress());
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, items: { "S1-01": { mastered: true } } }));
  assert.deepEqual(loadProgress(storage), emptyProgress());
});
