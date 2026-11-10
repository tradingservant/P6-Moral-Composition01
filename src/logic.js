/**
 * Pure rules for the five-station composition prep.
 * No DOM, network, or storage side effects except through the passed storage object.
 */

export const STORAGE_KEY = "p6-moral-composition01.v1";

export const TEACHER_REVIEW_IDS = Object.freeze([
  "S3-08",
  "S4-07",
  "S4-08",
  "S5-04",
  "S5-06",
  "S5-07",
]);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

export function normalizeShortText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-GB");
}

export function canonicalSequence(value) {
  if (Array.isArray(value)) {
    return value.map((part) => String(part).trim().toUpperCase()).filter(Boolean).join("-");
  }
  const letters = String(value ?? "").toUpperCase().match(/[A-D]/g);
  return letters ? letters.join("-") : "";
}

export function parseSequenceCards(prompt) {
  const matches = [...String(prompt ?? "").matchAll(/([A-D])\.\s*(.*?)(?=\s+[A-D]\.\s|$)/g)];
  return matches.map((match) => ({
    letter: match[1],
    text: match[2].trim(),
  }));
}

export function defaultSequence(item) {
  return parseSequenceCards(item.prompt).map((card) => card.letter);
}

export function moveLetter(letters, index, direction) {
  const copy = letters.slice();
  const next = index + direction;
  if (index < 0 || index >= copy.length || next < 0 || next >= copy.length || direction === 0) {
    return copy;
  }
  const [moved] = copy.splice(index, 1);
  copy.splice(next, 0, moved);
  return copy;
}

export function isCorrect(item, response) {
  if (!item || item.type === "teacher_review") return null;
  if (item.type === "short_text") {
    return normalizeShortText(response) === normalizeShortText(item.answer);
  }
  if (item.type === "single_choice") {
    return response === item.answer;
  }
  if (item.type === "sequence") {
    return canonicalSequence(response) === canonicalSequence(item.answer);
  }
  return null;
}

export function emptyProgress() {
  return { version: 1, items: {} };
}

function blankRecord(item) {
  if (item.type === "teacher_review") {
    return {
      type: "teacher_review",
      writing: "",
      draft: "",
      selfChecked: false,
      phase: "writing",
      mastered: false,
      graded: false,
    };
  }
  return {
    type: item.type,
    draft: "",
    sequence: item.type === "sequence" ? defaultSequence(item) : undefined,
    firstAttempt: null,
    retryAttempt: null,
    mastered: false,
    phase: "answering",
  };
}

function withItem(progress, id, record) {
  return {
    version: 1,
    items: {
      ...progress.items,
      [id]: record,
    },
  };
}

export function recordFor(progress, item) {
  return progress.items[item.id] || blankRecord(item);
}

export function setDraft(progress, item, draft) {
  const current = recordFor(progress, item);
  if (item.type === "teacher_review") {
    if (current.phase === "pending_teacher" || current.phase === "self_check") return progress;
    return withItem(progress, item.id, { ...current, draft: String(draft ?? "") });
  }
  if (current.phase === "revealed") return progress;
  return withItem(progress, item.id, { ...current, draft: String(draft ?? "") });
}

export function setSequenceOrder(progress, item, letters) {
  const current = recordFor(progress, item);
  if (item.type !== "sequence" || current.phase === "revealed") return progress;
  return withItem(progress, item.id, { ...current, sequence: letters.slice() });
}

export function submitResponse(progress, item, response) {
  const current = recordFor(progress, item);

  if (item.type === "teacher_review") {
    const writing = String(response ?? "");
    if (!writing.trim()) {
      return { progress, error: "empty" };
    }
    return {
      progress: withItem(progress, item.id, {
        ...current,
        type: "teacher_review",
        writing,
        draft: writing,
        selfChecked: false,
        phase: "self_check",
        mastered: false,
        graded: false,
      }),
    };
  }

  if (current.phase === "revealed") {
    return { progress };
  }

  const correct = isCorrect(item, response);
  if (current.phase === "answering") {
    return {
      progress: withItem(progress, item.id, {
        ...current,
        draft: Array.isArray(response) ? canonicalSequence(response) : String(response ?? ""),
        sequence: item.type === "sequence" ? canonicalSequence(response).split("-") : current.sequence,
        firstAttempt: { response: storedResponse(item, response), correct },
        retryAttempt: null,
        mastered: correct === true,
        phase: correct ? "revealed" : "hint",
      }),
    };
  }

  if (current.phase === "hint") {
    return {
      progress: withItem(progress, item.id, {
        ...current,
        draft: Array.isArray(response) ? canonicalSequence(response) : String(response ?? ""),
        sequence: item.type === "sequence" ? canonicalSequence(response).split("-") : current.sequence,
        firstAttempt: current.firstAttempt,
        retryAttempt: { response: storedResponse(item, response), correct },
        mastered: false,
        phase: "revealed",
      }),
    };
  }

  return { progress };
}

function storedResponse(item, response) {
  if (item.type === "sequence") return canonicalSequence(response);
  return String(response ?? "");
}

export function confirmSelfCheck(progress, item) {
  const current = recordFor(progress, item);
  if (item.type !== "teacher_review" || current.phase !== "self_check") return progress;
  return withItem(progress, item.id, {
    ...current,
    selfChecked: true,
    phase: "pending_teacher",
    mastered: false,
    graded: false,
  });
}

export function reviseWriting(progress, item) {
  const current = recordFor(progress, item);
  if (item.type !== "teacher_review") return progress;
  return withItem(progress, item.id, {
    ...current,
    phase: "writing",
    selfChecked: false,
    mastered: false,
    graded: false,
    draft: current.writing || current.draft || "",
  });
}

export function presentation(item, record) {
  const current = record || blankRecord(item);
  if (item.type === "teacher_review") {
    if (current.phase === "pending_teacher") {
      return {
        mode: "pending",
        showHint: false,
        showAnswer: true,
        showFeedback: true,
        status: "待老師核對",
        mastered: false,
      };
    }
    if (current.phase === "self_check") {
      return {
        mode: "self_check",
        showHint: false,
        showAnswer: false,
        showFeedback: true,
        status: "請先自查",
        mastered: false,
      };
    }
    return {
      mode: "writing",
      showHint: false,
      showAnswer: false,
      showFeedback: false,
      status: "",
      mastered: false,
    };
  }

  if (current.phase === "hint") {
    return {
      mode: "hint",
      showHint: true,
      showAnswer: false,
      showFeedback: false,
      status: "請再試一次",
      mastered: false,
    };
  }

  if (current.phase === "revealed") {
    let status = "尚未掌握";
    if (current.mastered) status = "已掌握";
    else if (current.retryAttempt && current.retryAttempt.correct) status = "重試答對，未計入掌握";
    return {
      mode: "revealed",
      showHint: false,
      showAnswer: true,
      showFeedback: true,
      status,
      mastered: current.mastered === true,
    };
  }

  return {
    mode: "answering",
    showHint: false,
    showAnswer: false,
    showFeedback: false,
    status: "",
    mastered: false,
  };
}

export function itemStatusLabel(item, record) {
  if (!record) return "未作答";
  if (item.type === "teacher_review") {
    if (record.phase === "pending_teacher") return "待老師核對";
    if (record.phase === "self_check") return "待自查";
    if (record.writing) return "寫作已存";
    return "未作答";
  }
  if (record.mastered) return "已掌握";
  if (record.phase === "hint") return "待重試";
  if (record.retryAttempt) return "已重試，未計入掌握";
  return "未作答";
}

export function stationSummary(station, progress) {
  const autos = station.items.filter((item) => item.type !== "teacher_review");
  const reviews = station.items.filter((item) => item.type === "teacher_review");
  const firstCorrect = autos.filter((item) => progress.items[item.id]?.mastered === true).length;
  const pendingTeacher = reviews.filter((item) => progress.items[item.id]?.phase === "pending_teacher").length;
  const rate = autos.length === 0 ? 0 : firstCorrect / autos.length;
  const reviewsReady = reviews.length === 0 || pendingTeacher === reviews.length;
  return {
    autoTotal: autos.length,
    firstCorrect,
    reviewTotal: reviews.length,
    pendingTeacher,
    firstCorrectRate: rate,
    readyToReduceHints: rate >= 0.75 && reviewsReady,
  };
}

export function contentInventory(data) {
  const stations = Array.isArray(data?.stations) ? data.stations : [];
  const items = stations.flatMap((station) => station.items.map((item) => ({ ...item, stationId: station.id })));
  const byType = {};
  for (const item of items) byType[item.type] = (byType[item.type] || 0) + 1;
  const teacher = items.filter((item) => item.type === "teacher_review").map((item) => item.id);
  return {
    stations: stations.length,
    perStation: stations.map((station) => station.items.length),
    total: items.length,
    teacher,
    auto: items.length - teacher.length,
    byType,
  };
}

export function validateContent(data) {
  const errors = [];
  const stations = data?.stations;
  if (!Array.isArray(stations)) return ["stations missing"];
  if (stations.length !== 5) errors.push("expected 5 stations");
  const seen = new Set();
  const teacher = [];
  stations.forEach((station, index) => {
    if (station.id !== index + 1) errors.push(`station id ${station.id}`);
    if (!Array.isArray(station.items) || station.items.length !== 8) {
      errors.push(`station ${station.id} item count`);
    }
    for (const item of station.items || []) {
      if (seen.has(item.id)) errors.push(`duplicate ${item.id}`);
      seen.add(item.id);
      for (const field of ["id", "type", "prompt", "answer", "feedback_zh", "hint_zh"]) {
        if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${item.id} missing ${field}`);
      }
      const texts = [item.prompt, item.answer, item.feedback_zh, item.hint_zh, ...(item.options || []), ...(item.accepted_answers || [])];
      if (texts.some((text) => EMOJI.test(String(text)))) errors.push(`${item.id} emoji`);
      if (item.type === "teacher_review") teacher.push(item.id);
      if (item.type === "single_choice") {
        if (!Array.isArray(item.options) || !item.options.includes(item.answer)) {
          errors.push(`${item.id} options`);
        }
      }
      if (item.type === "sequence") {
        const cards = parseSequenceCards(item.prompt);
        if (cards.length !== 4) errors.push(`${item.id} cards`);
        if (canonicalSequence(item.answer).split("-").length !== 4) errors.push(`${item.id} order`);
      }
      if (!["short_text", "single_choice", "sequence", "teacher_review"].includes(item.type)) {
        errors.push(`${item.id} type`);
      }
    }
  });
  const expectedTeacher = TEACHER_REVIEW_IDS.join(",");
  if (teacher.join(",") !== expectedTeacher) errors.push(`teacher ids ${teacher.join(",")}`);
  if (seen.size !== 40) errors.push(`total ${seen.size}`);
  return errors;
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export function loadProgress(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.items !== "object" || parsed.items === null || Array.isArray(parsed.items)) {
      return emptyProgress();
    }
    return { version: 1, items: parsed.items };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(storage, progress) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: progress.items }));
}

export function clearProgress(storage) {
  storage.removeItem(STORAGE_KEY);
}

export function allItems(data) {
  return data.stations.flatMap((station) => station.items);
}

export function findItem(data, id) {
  for (const station of data.stations) {
    const item = station.items.find((candidate) => candidate.id === id);
    if (item) return { station, item };
  }
  return null;
}
