/**
 * Share Copy Templates
 * Milestone 8.1: Rotating share copy for incorrect guesses
 *
 * Templates use placeholders:
 * - {WORD} → the user's guessed word
 * - {JACKPOT} → the prize INCLUDING its unit, e.g. "0.0216 ETH" or
 *   "78,125,000 $WORD". The unit used to be hardcoded next to the placeholder
 *   in every template, which meant a $WORD round would have advertised an ETH
 *   prize on nine different casts.
 *
 * All templates include at least one emoji.
 * URL is provided via embed, not in text.
 * Do not modify wording, punctuation, or emoji placement.
 */

/**
 * Share copy templates for incorrect guesses
 * Selected at random when share modal opens
 */
export const INCORRECT_GUESS_TEMPLATES: string[] = [
  `My guess "{WORD}" was wrong in @letshaveaword —
that's one less possible word for everyone else.

One person still wins the {JACKPOT} jackpot 👀 🎯`,

  `My guess "{WORD}" is off the board in @letshaveaword.

That's one fewer word standing between you and the {JACKPOT} jackpot 👀 🎯`,

  `"{WORD}" ❌

Another word eliminated in @letshaveaword —
one person takes the {JACKPOT} jackpot 🎯 👀`,

  `I just knocked "{WORD}" out of play in @letshaveaword.

The field keeps shrinking — and the {JACKPOT} jackpot is still live 👀 🎯`,

  `"{WORD}" is gone. ❌

Every wrong guess narrows the field —
one winner, {JACKPOT} 🎯 👀`,

  `My guess "{WORD}" was wrong in the global @letshaveaword game.

One shared word pool, one winner — {JACKPOT} 🎯 👀`,

  `I'm hunting for the secret word in @letshaveaword, but "{WORD}" isn't it 😫

One person still wins the {JACKPOT} jackpot 👀 🎯`,

  `Still hunting the secret word in @letshaveaword —
"{WORD}" was a miss 😫

The {JACKPOT} jackpot is still up for grabs 👀 🎯`,

  `"{WORD}" ❌ 😫

Secret word still hiding —
{JACKPOT} jackpot still up for grabs 🎯 👀`,
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
 * @param jackpot - Prize including its unit, e.g. "0.0216 ETH" or "78,125,000 $WORD"
 * @returns Rendered share text
 */
export function renderShareTemplate(
  template: string,
  word: string,
  jackpot: string
): string {
  return template
    .replace(/{WORD}/g, word.toUpperCase())
    .replace(/{JACKPOT}/g, jackpot);
}

/**
 * Get a fully rendered share text for an incorrect guess
 * @param word - The guessed word
 * @param jackpot - Current prize including its unit ("0.0216 ETH" / "78,125,000 $WORD")
 * @returns Object with template and rendered text
 */
export function getIncorrectGuessShareText(
  word: string,
  jackpot: string
): { template: string; rendered: string } {
  const template = getRandomTemplate();
  const rendered = renderShareTemplate(template, word, jackpot);
  return { template, rendered };
}
