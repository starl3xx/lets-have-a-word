Round **__ROUND__** is underway, so the round-36 word list expansion has taken
effect and its era gate is now dead weight on the guess hot path.

Nothing needs the pre-36 list any more: guesses, the wheel and Superguess
pricing only ever ask about the round being played, and every round from here
is 36 or later.

## Delete

- [ ] `WORDS_THROUGH_ROUND_35` in `src/data/guess_words_clean.ts`
- [ ] `LEGACY_WORDS_SET`, `WORD_LIST_EXPANSION_ROUND`, `isValidGuessForRound`, `getWordsForRound`, `wordSetForRound` in `src/lib/word-validation.ts`
- [ ] the four call sites: `src/lib/guesses.ts` (step 5a), `src/lib/wheel.ts`, `pages/api/superguess/status.ts`, `pages/api/superguess/purchase.ts`
- [ ] the additive checks in `validateWordLists()` (`src/lib/word-lists.ts`)
- [ ] the two-era assertions in `src/__tests__/word-lists.test.ts`
- [ ] the "through round 35" halves of the counts in `CLAUDE.md`, `README.md`, `docs/GITBOOK.md`, `docs/GAME_DOCUMENTATION.md`
- [ ] **this reminder**: `.github/workflows/round-36-gate-cleanup.yml` and `.github/round-36-cleanup-issue.md`

## Keep

`ROUND_36_ADDITIONS` can stay as its own array. It documents what was added and
when, and costs nothing once `WORDS` is the only list again.

## Do not re-derive

Answer and bonus selection were never gated, because `createRound` refuses to
run while a round is active, so every round created is 36 or later.

The client typing hint in `pages/index.tsx` is deliberately not gated either:
`currentRoundId` there is the archive modal's round, not the live one, and
feeding it in would mark real words invalid in later rounds.

_Opened automatically by `.github/workflows/round-36-gate-cleanup.yml`._
