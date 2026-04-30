# General Memory

## Spec review pattern: inline `**note:**` markers

When Marcus reviews a spec / PRD / SDD draft, he edits the file directly and inserts review feedback as `**note:**` lines next to the relevant content (e.g. under an acceptance-criterion bullet, or under a feature heading). His chat reply is typically short — "ich habe ein paar kommentare eingefügt" / "I've added a few comments" — and the actual feedback is in the file.

**Why:** Faster review than chat round-trips; inline placement preserves the exact context (which AC, which feature) without him needing to quote it in chat.

**How to apply:**
- When Marcus says he's added comments to a file, re-read the whole file and grep for `**note:**` (or similar inline review markers).
- Process every note as a feedback item to apply, not as commentary.
- Treat short notes like "drop it" as binding decisions (delete the feature), not suggestions.
- **Checkbox edits are approval signals.** When Marcus changes `[ ]` → `[x]` (or `[X]`) on an ADR / acceptance-criterion / validation-gate item, treat it as confirmation. No note text needed.
- **Inline questions are part of the review.** A `**note:**` containing a question (e.g. "what do you mean by this?") means: explain in chat AND rewrite the ambiguous text in the file so a future reader doesn't need the explanation.
- After applying, sweep the file to confirm no `**note:**` lines remain. Leftover notes are bugs.
- Capture each consumed note in the spec's decision log (README.md `Decisions Log` table) so the rationale survives.
