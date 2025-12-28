/**
 * Share Copy Templates
 * Milestone 8.1: Rotating share copy for incorrect guesses
 *
 * Templates use placeholders:
 * - {WORD} → the user's guessed word
 * - {JACKPOT} → current jackpot amount in ETH (formatted)
 *
 * All templates include the game URL and at least one emoji.
 * Do not modify wording, punctuation, or emoji placement.
 */

export const GAME_URL = 'letshaveaword.fun';

/**
 * Share copy templates for incorrect guesses
 * Selected at random when share modal opens
 */
export const INCORRECT_GUESS_TEMPLATES: string[] = [
  `My guess "{WORD}" was wrong in @letshaveaword —
that's one less possible word for everyone else.

One person still wins the {JACKPOT} ETH jackpot 👀 🎯
${GAME_URL}`,

  `My guess "{WORD}" is off the board in @letshaveaword.

That's one fewer word standing between you and the {JACKPOT} ETH jackpot 👀 🎯
${GAME_URL}`,

  `"{WORD}" ❌

Another word eliminated in @letshaveaword —
one person takes the {JACKPOT} ETH jackpot 🎯 👀
${GAME_URL}`,

  `I just knocked "{WORD}" out of play in @letshaveaword.

The field keeps shrinking — and the {JACKPOT} ETH jackpot is still live 👀 🎯
${GAME_URL}`,

  `"{WORD}" is gone. ❌

Every wrong guess narrows the field —
one winner, {JACKPOT} ETH 🎯 👀
${GAME_URL}`,

  `My guess "{WORD}" was wrong in the global @letshaveaword game.

One shared word pool, one winner — {JACKPOT} ETH 🎯 👀
${GAME_URL}`,

  `I'm hunting for the secret word in @letshaveaword, but "{WORD}" isn't it 😫

One person still wins the {JACKPOT} ETH jackpot 👀 🎯
${GAME_URL}`,

  `Still hunting the secret word in @letshaveaword —
"{WORD}" was a miss 😫

The {JACKPOT} ETH jackpot is still up for grabs 👀 🎯
${GAME_URL}`,

  `"{WORD}" ❌ 😫

Secret word still hiding —
{JACKPOT} ETH jackpot still up for grabs 🎯 👀
${GAME_URL}`,
];

/**
 * Select a random template from the list
 * @returns A random template string
 */
export function getRandomTemplate(): string {
  const index = Math.floor(Math.random() * INCORRECT_GUESS_TEMPLATES.length);
  return INCORRECT_GUESS_TEMPLATES[index];
}

/**
 * Inject dynamic values into a template
 * @param template - Template string with {WORD} and {JACKPOT} placeholders
 * @param word - The guessed word (will be uppercased)
 * @param jackpotEth - Jackpot amount in ETH (will be formatted)
 * @returns Rendered share text
 */
export function renderShareTemplate(
  template: string,
  word: string,
  jackpotEth: string
): string {
  return template
    .replace(/{WORD}/g, word.toUpperCase())
    .replace(/{JACKPOT}/g, jackpotEth);
}

/**
 * Get a fully rendered share text for an incorrect guess
 * @param word - The guessed word
 * @param jackpotEth - Current jackpot in ETH
 * @returns Object with template and rendered text
 */
export function getIncorrectGuessShareText(
  word: string,
  jackpotEth: string
): { template: string; rendered: string } {
  const template = getRandomTemplate();
  const rendered = renderShareTemplate(template, word, jackpotEth);
  return { template, rendered };
}
