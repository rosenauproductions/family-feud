# Family Feud question pack: AI prompt template

Copy everything below the line into any AI chat (ChatGPT, Claude, Gemini, Copilot…).
Replace the four `[[…]]` values first, or let the question bank editor fill them in for you
(Editor → **AI prompt**). Then paste the AI's reply into the editor with **Import from AI**.

---

You are writing questions for a home **Family Feud**-style party game. Write a question pack as JSON.

## What I want

- **Topic / theme:** [[TOPIC]]
- **Who's playing:** [[AUDIENCE]]
- **Number of questions:** [[QUESTION_COUNT]]
- **Pack name:** [[PACK_NAME]]

## How Family Feud questions work

Each question pretends 100 people were surveyed. The answers on the board are the most common
things those people said, ranked by how many people said each one. Players score by guessing
the *popular* answers, not the correct or clever ones.

- Phrase questions as survey prompts: "Name something…", "Name a…", "Tell me a…",
  "What's the first thing you…", "Besides X, name a…".
- Pick answers real people would blurt out within 3 seconds. Obvious and common beats clever.
- Each question needs **4 to 8 answers** (6–8 is best). Never more than 8.
- **Points** are how many of the 100 people gave that answer:
  - whole numbers, at least 1
  - sorted from most to fewest points
  - adding up to **exactly 100** for each question
  - the top answer is usually 25–45 points, and the last one is usually 2–5
- Merge answers that mean the same thing into one, joined with " / "
  (for example `"HANDS / GLOVES"`, `"TV / TELEVISION"`), so players get credit for either.
- Write answers in CAPITAL LETTERS, short (1–4 words, under 28 characters).
- No duplicate answers within a question, and no duplicate questions.
- Keep it fun and suitable for the audience above. Avoid anything mean, gross, or political
  unless the audience is clearly adults who'd enjoy it.
- Vary the questions: mix easy and tricky ones, and don't reuse the same opening every time.

## Output format

Reply with **only** a JSON code block in exactly this shape, with no commentary before or after:

```json
{
  "name": "Things in Pairs Edition",
  "questions": [
    {
      "question": "Name something that comes in pairs.",
      "answers": [
        { "text": "SHOES", "points": 32 },
        { "text": "SOCKS", "points": 25 },
        { "text": "EYES", "points": 18 },
        { "text": "HANDS / GLOVES", "points": 12 },
        { "text": "FEET", "points": 8 },
        { "text": "EARRINGS", "points": 5 }
      ]
    }
  ]
}
```

## Before you answer, check every question

1. 4–8 answers, never more than 8.
2. Points are whole numbers, sorted high to low, and **add up to exactly 100**.
3. Answers are in CAPS, short, and not repeated.
4. It's valid JSON: double quotes, no trailing commas, no comments.
5. There are exactly [[QUESTION_COUNT]] questions about [[TOPIC]].
