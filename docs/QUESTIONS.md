# Question bank

Questions live in [`shared/data/questions.json`](../shared/data/questions.json). The Worker validates the file when it starts, and `npm run validate:questions` runs the same checks. The bank is bundled into the Worker only. The browser never receives it, just the question being played, with its options shuffled and no answer.

## Format

```json
{
  "version": 1,
  "questions": [
    {
      "id": "sci-octopus-hearts",
      "category": "science",
      "text": "How many hearts does an octopus have?",
      "options": ["3", "1", "2", "8"],
      "correctIndex": 0,
      "source": "Smithsonian Ocean — Octopuses",
      "fact": "Two hearts pump blood through the gills and the third pumps it around the body."
    }
  ]
}
```

This matches the game's `Question` interface (`shared/engine/state.ts`):

| Field | Rules |
| --- | --- |
| `id` | Unique, 1–48 characters of `a-z`, `0-9`, `-`. The convention is a category prefix (`sci-`, `spo-`, `ent-`, `geo-`, `his-`, `wei-`, `gen-`). |
| `category` | One of `science`, `sports`, `entertainment`, `geography`, `history`, `weird`, `general`. |
| `text` | 10–200 characters, and unique. |
| `options` | Exactly 4 distinct strings of 1–60 characters each. |
| `correctIndex` | 0–3, the position of the correct option in `options`. The server reshuffles the options every time it deals the question, so the stored order doesn't matter. |
| `source` | Required. A reference a parent could check, such as an organization, page title, or book. |
| `fact` | Optional, at most 300 characters. Shown after the answer is revealed. |

## Writing good questions

- Keep them family-friendly, and make sure exactly one option is unambiguously correct. Avoid facts that change often, like records, current champions, or "the latest…".
- Mix the difficulty. The best ones are questions adults overthink and kids get right, such as *What's the closest star to Earth?* (the Sun), or questions with a tempting wrong answer, such as *hottest planet* (Venus, not Mercury).
- Cite where you checked the fact.
- Run `npm run validate:questions`, then `npm test`.

A game needs at least as many questions in the selected categories as the configured number of rounds. The host sees a warning in the lobby if there aren't enough.
