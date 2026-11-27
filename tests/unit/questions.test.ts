import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../shared/constants";
import { QUESTIONS, validateQuestionBank } from "../../shared/questions";
import bank from "../../shared/data/questions.json";

describe("question bank", () => {
  it("has at least 600 valid questions (the spec requires 100)", () => {
    const { errors, questions } = validateQuestionBank(bank);
    expect(errors).toEqual([]);
    expect(questions.length).toBeGreaterThanOrEqual(600);
    expect(QUESTIONS.length).toBe(questions.length);
  });

  it("covers every category with plenty of questions for repeated 20-round games", () => {
    for (const c of CATEGORIES) {
      expect(QUESTIONS.filter((q) => q.category === c).length, c).toBeGreaterThanOrEqual(80);
    }
  });

  it("has exactly four distinct options, one correct answer, and a source for every question", () => {
    for (const q of QUESTIONS) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(4);
      expect(q.source.length).toBeGreaterThan(3);
    }
  });

  it("doesn't always store the correct answer in the same slot", () => {
    const slots = new Set(QUESTIONS.map((q) => q.correctIndex));
    expect(slots.size).toBe(4);
  });

  it("rejects malformed questions with helpful errors", () => {
    const { errors } = validateQuestionBank({
      version: 1,
      questions: [
        { id: "ok-1", category: "science", text: "What is a fine question?", options: ["a", "b", "c", "d"], correctIndex: 0, source: "Test" },
        { id: "ok-1", category: "science", text: "Duplicate id question?", options: ["a", "b", "c", "d"], correctIndex: 0, source: "Test" },
        { id: "bad-cat", category: "cooking", text: "Unknown category here?", options: ["a", "b", "c", "d"], correctIndex: 0, source: "Test" },
        { id: "three", category: "science", text: "Only three options here?", options: ["a", "b", "c"], correctIndex: 0, source: "Test" },
        { id: "dupe-opt", category: "science", text: "Duplicate options here?", options: ["a", "A", "c", "d"], correctIndex: 0, source: "Test" },
        { id: "bad-index", category: "science", text: "Correct index out of range?", options: ["a", "b", "c", "d"], correctIndex: 4, source: "Test" },
        { id: "no-source", category: "science", text: "Missing a source here?", options: ["a", "b", "c", "d"], correctIndex: 1, source: "" },
        { id: "Bad Id!", category: "science", text: "Invalid id characters?", options: ["a", "b", "c", "d"], correctIndex: 1, source: "Test" },
      ],
    });
    expect(errors.join("\n")).toMatch(/ok-1.*duplicate id/);
    expect(errors.join("\n")).toMatch(/unknown category "cooking"/);
    expect(errors.join("\n")).toMatch(/three.*exactly 4 options/);
    expect(errors.join("\n")).toMatch(/dupe-opt.*distinct/);
    expect(errors.join("\n")).toMatch(/bad-index.*correctIndex/);
    expect(errors.join("\n")).toMatch(/no-source.*source/);
    expect(errors.join("\n")).toMatch(/id must be/);
  });

  it("rejects an unknown bank version", () => {
    expect(validateQuestionBank({ version: 2, questions: [] }).errors[0]).toMatch(/version/);
  });
});
