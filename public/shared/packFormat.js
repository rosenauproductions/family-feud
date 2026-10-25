/**
 * Question pack format — shared by the server (save validation) and the
 * question bank editor. Keep in sync with public/editor/question-pack.schema.json
 * and public/editor/ai-template.md.
 *
 * {
 *   "name": "Pack Display Name",
 *   "questions": [
 *     { "question": "Name something…", "answers": [ { "text": "ANSWER", "points": 42 } ] }
 *   ]
 * }
 */

export const MAX_ANSWERS = 8; // the board has 8 slots; extra answers are dropped in game
export const MIN_ANSWERS_RECOMMENDED = 4;
export const TARGET_TOTAL = 100;
export const MAX_FILENAME = 80;

/** Turn a pack name into the filename convention used by the existing packs ("-Name.json") */
export function filenameForName(name) {
  const base = String(name ?? '')
    .replace(/\b(edition|pack)\b/gi, '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME - 6);
  return `-${base || 'New Pack'}.json`;
}

/** Safe, cross-platform filename (no folders, no reserved characters, ends in .json) */
export function isSafeFilename(file) {
  return (
    typeof file === 'string' &&
    file.length > 5 &&
    file.length <= MAX_FILENAME &&
    file.endsWith('.json') &&
    !/[\\/:*?"<>|\u0000-\u001f]/.test(file) &&
    !file.startsWith('.') &&
    file.trim() === file
  );
}

/**
 * Pull a pack out of text an AI (or a person) pasted: tolerates ```json fences,
 * chatter before/after the JSON, and a bare array of questions.
 */
export function parsePackText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Nothing to import — paste the JSON first.');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw];
  const firstObj = raw.indexOf('{');
  const lastObj = raw.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(raw.slice(firstObj, lastObj + 1));
  const firstArr = raw.indexOf('[');
  const lastArr = raw.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(raw.slice(firstArr, lastArr + 1));

  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const data = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); // forgive trailing commas
      if (Array.isArray(data)) return normalizePack({ name: '', questions: data });
      if (data && typeof data === 'object') return normalizePack(data);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Couldn't read that as JSON${lastError ? ` (${lastError.message})` : ''}.`);
}

/** Coerce loose input into the pack shape (doesn't enforce rules — see validatePack) */
export function normalizePack(data) {
  const questions = Array.isArray(data?.questions) ? data.questions : [];
  return {
    name: String(data?.name ?? data?.title ?? '').trim(),
    questions: questions.map((q) => ({
      question: String(q?.question ?? q?.prompt ?? q?.text ?? '').trim(),
      answers: (Array.isArray(q?.answers) ? q.answers : []).map((a) => ({
        text: String(a?.text ?? a?.answer ?? '').trim(),
        points: Number.isFinite(Number(a?.points)) ? Math.round(Number(a.points)) : 0,
      })),
    })),
  };
}

/**
 * Check a pack. Errors block saving (the game would break or drop data);
 * warnings are style issues the host may want to fix.
 * Each issue: { level: 'error' | 'warning', message, q?: questionIndex, a?: answerIndex }
 */
export function validatePack(pack) {
  const issues = [];
  const error = (message, q, a) => issues.push({ level: 'error', message, q, a });
  const warn = (message, q, a) => issues.push({ level: 'warning', message, q, a });

  if (!pack || typeof pack !== 'object') {
    error('Pack must be a JSON object with "name" and "questions".');
    return issues;
  }
  if (!String(pack.name ?? '').trim()) error('Give the pack a name.');
  if (!Array.isArray(pack.questions) || pack.questions.length === 0) {
    error('Add at least one question.');
    return issues;
  }

  const seenQuestions = new Map();
  pack.questions.forEach((q, qi) => {
    const label = `Question ${qi + 1}`;
    const text = String(q?.question ?? '').trim();
    if (!text) error(`${label}: question text is empty.`, qi);
    else {
      const key = text.toLowerCase();
      if (seenQuestions.has(key)) warn(`${label}: same as question ${seenQuestions.get(key) + 1}.`, qi);
      else seenQuestions.set(key, qi);
    }

    const answers = Array.isArray(q?.answers) ? q.answers : [];
    if (answers.length === 0) {
      error(`${label}: add at least one answer.`, qi);
      return;
    }
    if (answers.length > MAX_ANSWERS) {
      error(`${label}: ${answers.length} answers — the board only holds ${MAX_ANSWERS}.`, qi);
    } else if (answers.length < MIN_ANSWERS_RECOMMENDED) {
      warn(`${label}: only ${answers.length} answer${answers.length === 1 ? '' : 's'} (4–8 plays best).`, qi);
    }

    const seenAnswers = new Map();
    let total = 0;
    let sorted = true;
    answers.forEach((a, ai) => {
      const answerText = String(a?.text ?? '').trim();
      const pts = a?.points;
      if (!answerText) error(`${label}, answer ${ai + 1}: text is empty.`, qi, ai);
      else {
        const key = answerText.toLowerCase();
        if (seenAnswers.has(key)) warn(`${label}: "${answerText}" is listed twice.`, qi, ai);
        else seenAnswers.set(key, ai);
        if (answerText.length > 28) warn(`${label}: "${answerText}" is long and may wrap on the board.`, qi, ai);
      }
      if (!Number.isInteger(pts) || pts < 1) error(`${label}, answer ${ai + 1}: points must be a whole number of 1 or more.`, qi, ai);
      else total += pts;
      if (ai > 0 && Number.isInteger(pts) && pts > answers[ai - 1]?.points) sorted = false;
    });

    if (!sorted) warn(`${label}: answers aren't sorted from most to fewest points.`, qi);
    if (total > 0 && total !== TARGET_TOTAL) warn(`${label}: points add up to ${total} (aim for ${TARGET_TOTAL}).`, qi);
  });

  return issues;
}

export function hasErrors(issues) {
  return issues.some((i) => i.level === 'error');
}

/** Pretty JSON in the same style as the hand-made packs (one answer per line) */
export function formatPackJson(pack) {
  const lines = ['{', `  "name": ${JSON.stringify(pack.name)},`, '  "questions": ['];
  pack.questions.forEach((q, qi) => {
    lines.push('    {');
    lines.push(`      "question": ${JSON.stringify(q.question)},`);
    lines.push('      "answers": [');
    q.answers.forEach((a, ai) => {
      const comma = ai < q.answers.length - 1 ? ',' : '';
      lines.push(`        { "text": ${JSON.stringify(a.text)}, "points": ${a.points} }${comma}`);
    });
    lines.push('      ]');
    lines.push(`    }${qi < pack.questions.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

/** Rescale a question's points so they total TARGET_TOTAL, keeping order and minimum 1 */
export function scalePointsTo100(answers) {
  const total = answers.reduce((s, a) => s + (Number(a.points) || 0), 0);
  if (total <= 0) return answers;
  const scaled = answers.map((a) => ({ ...a, points: Math.max(1, Math.round(((Number(a.points) || 0) * TARGET_TOTAL) / total)) }));
  let diff = TARGET_TOTAL - scaled.reduce((s, a) => s + a.points, 0);
  // settle rounding on the top answer (or the next one down if it would drop below 1)
  for (let i = 0; diff !== 0 && i < scaled.length; i += 1) {
    const next = scaled[i].points + diff;
    if (next >= 1) {
      scaled[i] = { ...scaled[i], points: next };
      diff = 0;
    }
  }
  return scaled;
}
