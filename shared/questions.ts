/**
 * Question bank. Questions live in shared/data/questions.json (format in
 * docs/QUESTIONS.md). The bank is validated at load time so a bad edit fails
 * fast — both in `npm test` and when the Worker starts.
 *
 * The bank is imported by the server only. The browser bundle never includes
 * it, so correct answers can't be read out of the frontend code.
 */
import bank from "./data/questions.json";
import { CATEGORIES, LIMITS, type Category } from "./constants";
import type { Question } from "./engine/state";

export interface QuestionBankFile {
  version: number;
  questions: unknown[];
}

const MAX_OPTION_LENGTH = 60;

export function validateQuestionBank(file: QuestionBankFile): { questions: Question[]; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  const questions: Question[] = [];
  if (file.version !== 1) errors.push(`Unsupported question bank version: ${file.version}`);
  for (const [i, raw] of (file.questions ?? []).entries()) {
    const q = raw as Partial<Question> | null;
    const where = `questions[${i}] (${q?.id ?? "no id"})`;
    if (!q || typeof q.id !== "string" || !/^[a-z0-9-]{1,48}$/.test(q.id)) {
      errors.push(`${where}: id must be 1-48 chars of a-z, 0-9, '-'`);
      continue;
    }
    if (ids.has(q.id)) errors.push(`${where}: duplicate id`);
    ids.add(q.id);
    if (!CATEGORIES.includes(q.category as Category)) errors.push(`${where}: unknown category "${q.category}"`);
    const text = typeof q.text === "string" ? q.text.trim() : "";
    if (text.length < 10 || text.length > 200) errors.push(`${where}: text must be 10-200 characters`);
    const key = text.toLowerCase();
    if (texts.has(key)) errors.push(`${where}: duplicate question text`);
    texts.add(key);
    const options = Array.isArray(q.options) ? q.options.map((o) => (typeof o === "string" ? o.trim() : "")) : [];
    if (options.length !== LIMITS.optionCount) errors.push(`${where}: needs exactly ${LIMITS.optionCount} options`);
    if (options.some((o) => !o || o.length > MAX_OPTION_LENGTH)) {
      errors.push(`${where}: options must be 1-${MAX_OPTION_LENGTH} characters`);
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) errors.push(`${where}: options must be distinct`);
    if (!Number.isInteger(q.correctIndex) || q.correctIndex! < 0 || q.correctIndex! >= LIMITS.optionCount) {
      errors.push(`${where}: correctIndex must be 0-3`);
    }
    const source = typeof q.source === "string" ? q.source.trim() : "";
    if (source.length < 3) errors.push(`${where}: a source reference is required`);
    if (q.fact !== undefined && (typeof q.fact !== "string" || q.fact.length > 300)) {
      errors.push(`${where}: fact must be a string of at most 300 characters`);
    }
    questions.push({
      id: q.id,
      category: q.category as Category,
      text,
      options: options as Question["options"],
      correctIndex: q.correctIndex as number,
      source,
      ...(q.fact ? { fact: q.fact.trim() } : {}),
    });
  }
  return { questions, errors };
}

const loaded = validateQuestionBank(bank as QuestionBankFile);
if (loaded.errors.length) {
  throw new Error(`Invalid question bank:\n${loaded.errors.join("\n")}`);
}

export const QUESTIONS: readonly Question[] = Object.freeze(loaded.questions);
