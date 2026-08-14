import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { guesses } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createTestRound, retireActiveRounds } from './helpers/rounds';
import { getWrongWordsForRound } from '../lib/guesses';
import { getWheelWordsForRound } from '../lib/wheel';

/**
 * An ineligible winner is a correct guess from an account that failed the
 * sybil check: stored with `is_correct = true` AND `is_ineligible_winner =
 * true`. It does not lock the round.
 *
 * The invariant, documented in guesses.ts, is that such a guess must be
 * OBSERVABLY INDISTINGUISHABLE from an ordinary wrong guess. If any public
 * surface treats it differently, comparing surfaces reveals the answer — and
 * the answer is the prize pool.
 *
 * That is not hypothetical here: /api/wheel marked these words `wrong` while
 * /api/wheel/wrong-guesses omitted them, so diffing two public responses named
 * the secret word. Both endpoints are unauthenticated.
 *
 * These tests compare the two sources directly, which is the attack itself
 * rather than a proxy for it.
 */

describe('ineligible winner is indistinguishable from a wrong guess', () => {
  let roundId: number;
  const ANSWER = 'BRAIN';

  beforeEach(async () => {
    const round = await createTestRound({ forceAnswer: ANSWER });
    roundId = round.id;

    await db.insert(guesses).values([
      // An ordinary wrong guess.
      { roundId, fid: 1001, word: 'HOUSE', isCorrect: false, guessIndexInRound: 1 },
      // The sybil's correct guess: right word, refused the win.
      {
        roundId,
        fid: 1002,
        word: ANSWER,
        isCorrect: true,
        isIneligibleWinner: true,
        guessIndexInRound: 2,
      },
    ]);
  });

  it('lists the ineligible winner among the wrong words', async () => {
    const words = await getWrongWordsForRound(roundId);
    expect(words).toContain(ANSWER);
    expect(words).toContain('HOUSE');
  });

  it('marks it wrong on the wheel, not as the winner', async () => {
    const wheel = await getWheelWordsForRound(roundId);
    const entry = wheel.find((w) => w.word === ANSWER);

    // 'winner' would announce the answer outright; 'unguessed' would make it
    // the one guessed word that never turned, which is the same tell.
    expect(entry?.status).toBe('wrong');
  });

  it('the two public views agree — nothing appears in one and not the other', async () => {
    // The attack, run directly: diff the endpoints and see if a word falls out.
    const wrongWords = new Set(await getWrongWordsForRound(roundId));
    const wheelWrong = new Set(
      (await getWheelWordsForRound(roundId))
        .filter((w) => w.status === 'wrong')
        .map((w) => w.word)
    );

    const onlyOnWheel = [...wheelWrong].filter((w) => !wrongWords.has(w));
    const onlyInList = [...wrongWords].filter((w) => !wheelWrong.has(w));

    expect(onlyOnWheel).toEqual([]);
    expect(onlyInList).toEqual([]);
  });

  it('still hides the answer while it is merely unguessed', async () => {
    // The other half of the invariant: before anyone guesses it, the answer
    // must look like every other unguessed word.
    await retireActiveRounds();
    const other = await createTestRound({ forceAnswer: 'CRANE' });
    await db.insert(guesses).values({
      roundId: other.id,
      fid: 1003,
      word: 'HOUSE',
      isCorrect: false,
      guessIndexInRound: 1,
    });

    const wheel = await getWheelWordsForRound(other.id);
    expect(wheel.find((w) => w.word === 'CRANE')?.status).toBe('unguessed');
    expect(await getWrongWordsForRound(other.id)).not.toContain('CRANE');

    await db.delete(guesses).where(eq(guesses.roundId, other.id));
  });
});
