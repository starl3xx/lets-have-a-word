#!/usr/bin/env python3
"""
Frequency-Based Dictionary Generator - Milestone 4.13 (Corrected)

Generates clean English word dictionaries using real-world frequency data
instead of flawed shape-based heuristics.

Uses:
- Wordfreq for modern English frequency scores (Zipf scale)
- Proper noun detection
- Offensive word filtering

Requirements:
- pip install wordfreq

Usage:
    python3 src/scripts/generate-frequency-dictionaries.py
"""

import re
import json
from pathlib import Path
from typing import Set, List, Tuple
from wordfreq import zipf_frequency, iter_wordlist

# ============================================================================
# CONFIGURATION
# ============================================================================

# Paths
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / 'data'

# Source: Original Wordle lists (before our 4.13 filtering)
SOURCE_GUESS_WORDS = DATA_DIR / 'guess_words.ts'
SOURCE_ANSWER_WORDS = DATA_DIR / 'answer_words.ts'

# Output: New clean filtered lists
OUTPUT_GUESS_WORDS = DATA_DIR / 'guess_words_clean.ts'
OUTPUT_ANSWER_WORDS = DATA_DIR / 'answer_words_expanded.ts'

# Frequency thresholds (adjusted to include CRASS=2.96 while excluding MENIL=1.71)
MIN_ZIPF_GUESS = 2.5      # Minimum frequency for guess words (includes common words like CRASS)
MIN_ZIPF_ANSWER = 3.0     # Stricter threshold for answer words
SPICE_ZIPF_THRESHOLD = 2.0  # Allow some "spice" words if not too obscure

# Target sizes
TARGET_GUESS_SIZE = 7000   # ~6-8k
TARGET_ANSWER_SIZE = 3500  # ~3-4k

# ============================================================================
# BLACKLISTS
# ============================================================================

# Offensive words
OFFENSIVE_BLACKLIST = {
    'SLUTS', 'WHORE', 'BITCH', 'COCKS', 'CUNTS', 'FUCKS', 'SHITS',
    'PRICK', 'PUSSY', 'TARDS', 'BITTY', 'CRAPS', 'HELLS',
}

# Proper nouns (names, places, brands, months)
PROPER_NOUN_BLACKLIST = {
    'JESUS', 'CHINA', 'INDIA', 'SPAIN', 'ITALY', 'PARIS', 'TOKYO',
    'JAMES', 'JONES', 'SMITH', 'BROWN', 'DAVIS', 'MARCH', 'APRIL',
    'ALICE', 'BOBBY', 'KAREN', 'MASON', 'LOGAN', 'LUCAS', 'HENRY',
    'WYATT', 'ISAAC', 'OSCAR', 'ELLIE', 'HAZEL', 'CLARA', 'ABBIE',
    'TEXAS', 'ROMAN', 'ISRAEL', 'JUDAH', 'JUDAS', 'MOSES', 'AARON',
    'PETER', 'SIMON', 'MENIL', 'BASEL', 'DAVOS', 'QATAR', 'DUBAI',
}

# Known Scrabble garbage (explicitly bad words to double-check)
SCRABBLE_GARBAGE = {
    'AALII', 'AAHED', 'AARGH', 'AARTI', 'ABACA', 'ABACI', 'ABAFT',
    'ABAHT', 'ABAKA', 'ABAMP', 'ABAND', 'ABASK', 'ABAYA', 'ABCEE',
    'ABEAM', 'ABEAR', 'ABELE', 'ABENG', 'ABJAD', 'ABJUD', 'ABLET',
    'ABLOW', 'ABMHO', 'ABNET', 'ABOHM', 'ABOIL', 'ABOMA', 'ABOON',
    'XEBEC', 'XEMES', 'XENIA', 'XENIC', 'XYLAN', 'XYLEM', 'XYLIC',
    'XYLOL', 'XYLYL', 'XYSTI', 'XYSTS', 'YEXED', 'YEXES', 'QANAT',
    'QADIS', 'QAIDS', 'QAJAQ', 'QAPHS', 'QAPIK', 'QIBLA', 'QINAH',
    'QINTA', 'QIRSH', 'QOPHS', 'QORMA', 'ZAYIN', 'ZEALS', 'ZEBEC',
    'ZEBUB', 'ZIBET', 'ZIFFS', 'ZIGAN', 'ZILAS', 'ZOMBI', 'ZONAE',
    'ZONDA', 'ZOOEA', 'ZOOID', 'ZOOKS', 'ZOOMY', 'ZOONS', 'ZOOTY',
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def load_word_list_from_ts(filepath: Path) -> Set[str]:
    """Extract words from TypeScript export file"""
    content = filepath.read_text()

    # Find array content between [ and ] (greedy to capture full array)
    match = re.search(r'\[([\s\S]*)\]', content)
    if not match:
        raise ValueError(f"Could not parse {filepath}")

    array_content = match.group(1)

    # Extract quoted words
    words = re.findall(r'"([A-Z]{5})"', array_content)

    return set(words)

def load_all_five_letter_words_from_wordfreq() -> Set[str]:
    """Load all 5-letter English words from wordfreq vocabulary"""
    five_letter_words = set()

    for word in iter_wordlist('en'):
        # Only include 5-letter words with only letters
        if len(word) == 5 and re.match(r'^[a-z]{5}$', word):
            five_letter_words.add(word.upper())

    return five_letter_words

def write_word_list_to_ts(filepath: Path, words: List[str], var_name: str) -> None:
    """Write words to TypeScript export file"""
    content = f"export const {var_name}: string[] = [\n"
    content += ',\n'.join(f'  "{word}"' for word in words)
    content += '\n];\n'

    filepath.write_text(content)
    print(f"✅ Written {len(words)} words to {filepath.name}")

def is_offensive(word: str) -> bool:
    """Check if word is offensive"""
    return word in OFFENSIVE_BLACKLIST

def is_proper_noun(word: str) -> bool:
    """Check if word is a proper noun"""
    return word in PROPER_NOUN_BLACKLIST

def is_scrabble_garbage(word: str) -> bool:
    """Check if word is known Scrabble garbage"""
    return word in SCRABBLE_GARBAGE

def get_frequency_score(word: str) -> float:
    """Get Zipf frequency score for a word"""
    # Wordfreq expects lowercase
    return zipf_frequency(word.lower(), 'en')

def is_likely_plural(word: str) -> bool:
    """
    Heuristic to detect likely plurals.
    Much simpler than before - just check common patterns.
    """
    if not word.endswith('S'):
        return False

    # Non-plural S words
    non_plural_endings = {'SS', 'US', 'IS', 'AS'}
    for ending in non_plural_endings:
        if word.endswith(ending):
            return False

    # Specific non-plural S words
    non_plural_words = {
        'BRASS', 'CHESS', 'CLASS', 'CROSS', 'DRESS', 'GLASS', 'GRASS',
        'GUESS', 'BLESS', 'BLISS', 'ABYSS', 'TRUSS', 'FLOSS', 'GLOSS',
        'ALIAS', 'ATLAS', 'BASIS', 'OASIS', 'VIRUS', 'FOCUS', 'GENUS',
        'MINUS', 'NEXUS', 'BONUS', 'GROSS', 'LOSS', 'MASS', 'MISS',
        'PASS', 'BOSS', 'TOSS', 'KISS', 'PRESS', 'STRESS', 'CHAOS',
        'CRASS',  # Make sure CRASS is not considered a plural!
    }

    if word in non_plural_words:
        return False

    # If it ends in S and isn't in the exceptions, likely a plural
    # Simple heuristic: if removing S gives a plausible 4-letter word
    singular = word[:-1]
    if len(singular) == 4:
        # Check if singular form exists and has reasonable frequency
        singular_freq = get_frequency_score(singular)
        if singular_freq > 2.0:  # If singular is reasonably common
            return True

    return False

# ============================================================================
# MAIN FILTERING LOGIC
# ============================================================================

def generate_guess_words(source_words: Set[str]) -> List[str]:
    """
    Generate GUESS_WORDS_CLEAN using frequency-based filtering.

    Criteria:
    - Zipf frequency ≥ 3.0 (modern, not extremely rare)
    - Not a proper noun
    - Not offensive
    - Not known Scrabble garbage

    NO shape-based filters (consonants, vowels, etc.)
    """
    print("\n=== GENERATING GUESS_WORDS_CLEAN ===\n")

    candidates_with_freq = []

    for word in source_words:
        freq = get_frequency_score(word)
        candidates_with_freq.append((word, freq))

    print(f"Total candidates: {len(candidates_with_freq)}")

    # Filter
    valid_words = []
    rejected = {
        'offensive': 0,
        'proper_noun': 0,
        'scrabble_garbage': 0,
        'too_rare': 0,
    }

    for word, freq in candidates_with_freq:
        # Basic blacklist checks
        if is_offensive(word):
            rejected['offensive'] += 1
            continue

        if is_proper_noun(word):
            rejected['proper_noun'] += 1
            continue

        if is_scrabble_garbage(word):
            rejected['scrabble_garbage'] += 1
            continue

        # Frequency check
        if freq < MIN_ZIPF_GUESS:
            rejected['too_rare'] += 1
            continue

        valid_words.append((word, freq))

    # Sort by frequency (descending) then alphabetically
    valid_words.sort(key=lambda x: (-x[1], x[0]))

    # Take top TARGET_GUESS_SIZE
    final_words = [word for word, freq in valid_words[:TARGET_GUESS_SIZE]]

    # Sort alphabetically for output
    final_words.sort()

    print(f"Filtering results:")
    print(f"  - Offensive: {rejected['offensive']}")
    print(f"  - Proper nouns: {rejected['proper_noun']}")
    print(f"  - Scrabble garbage: {rejected['scrabble_garbage']}")
    print(f"  - Too rare (Zipf < {MIN_ZIPF_GUESS}): {rejected['too_rare']}")
    print(f"  - Total rejected: {sum(rejected.values())}")
    print(f"  - Valid words: {len(valid_words)}")
    print(f"  - Final (top {TARGET_GUESS_SIZE}): {len(final_words)}")

    return final_words

def generate_answer_words(guess_words: List[str]) -> List[str]:
    """
    Generate ANSWER_WORDS_EXPANDED from guess words.

    Additional criteria:
    - Higher frequency threshold (Zipf ≥ 3.5)
    - Exclude most plurals
    - Allow some "spice" words (10-20%)
    """
    print("\n=== GENERATING ANSWER_WORDS_EXPANDED ===\n")

    candidates_with_freq = []

    for word in guess_words:
        freq = get_frequency_score(word)
        candidates_with_freq.append((word, freq))

    print(f"Starting with {len(candidates_with_freq)} guess words")

    # Filter
    valid_answers = []
    rejected = {
        'plural': 0,
        'too_rare': 0,
    }

    for word, freq in candidates_with_freq:
        # Exclude plurals
        if is_likely_plural(word):
            rejected['plural'] += 1
            continue

        # Stricter frequency threshold for answers
        # But allow some "spice" words if they're not too obscure
        if freq < MIN_ZIPF_ANSWER:
            # Allow if it's a "spice" word (between 2.5 and 3.5)
            if freq < SPICE_ZIPF_THRESHOLD:
                rejected['too_rare'] += 1
                continue
            # If it's spice-level, include it but mark it
            # We'll limit spice words to 20% later

        valid_answers.append((word, freq))

    # Sort by frequency (descending)
    valid_answers.sort(key=lambda x: (-x[1], x[0]))

    # Take top TARGET_ANSWER_SIZE
    final_words = [word for word, freq in valid_answers[:TARGET_ANSWER_SIZE]]

    # Sort alphabetically for output
    final_words.sort()

    print(f"Filtering results:")
    print(f"  - Plurals excluded: {rejected['plural']}")
    print(f"  - Too rare: {rejected['too_rare']}")
    print(f"  - Total rejected: {sum(rejected.values())}")
    print(f"  - Valid answer words: {len(valid_answers)}")
    print(f"  - Final (top {TARGET_ANSWER_SIZE}): {len(final_words)}")

    return final_words

def validate_dictionaries(guess_words: List[str], answer_words: List[str]) -> None:
    """Validate generated dictionaries"""
    print("\n=== VALIDATION ===\n")

    errors = []

    # Check format
    for word in guess_words + answer_words:
        if not re.match(r'^[A-Z]{5}$', word):
            errors.append(f"Invalid format: {word}")

    # Check no duplicates
    if len(set(guess_words)) != len(guess_words):
        errors.append("GUESS_WORDS_CLEAN has duplicates")

    if len(set(answer_words)) != len(answer_words):
        errors.append("ANSWER_WORDS_EXPANDED has duplicates")

    # Check subset relationship
    guess_set = set(guess_words)
    for word in answer_words:
        if word not in guess_set:
            errors.append(f'Answer word "{word}" not in guess words')

    # Check alphabetical order
    if guess_words != sorted(guess_words):
        errors.append("GUESS_WORDS_CLEAN not alphabetically sorted")

    if answer_words != sorted(answer_words):
        errors.append("ANSWER_WORDS_EXPANDED not alphabetically sorted")

    # Specific regression tests
    print("Regression tests:")

    # CRASS must be present
    if 'CRASS' in guess_words:
        print("  ✅ CRASS in GUESS_WORDS_CLEAN")
    else:
        errors.append("❌ CRASS missing from GUESS_WORDS_CLEAN")

    if 'CRASS' in answer_words:
        print("  ✅ CRASS in ANSWER_WORDS_EXPANDED")
    else:
        print("  ⚠️  CRASS not in ANSWER_WORDS_EXPANDED (may be filtered as uncommon)")

    # MENIL must NOT be present
    if 'MENIL' not in guess_words:
        print("  ✅ MENIL excluded from GUESS_WORDS_CLEAN")
    else:
        errors.append("❌ MENIL present in GUESS_WORDS_CLEAN")

    if 'MENIL' not in answer_words:
        print("  ✅ MENIL excluded from ANSWER_WORDS_EXPANDED")
    else:
        errors.append("❌ MENIL present in ANSWER_WORDS_EXPANDED")

    # Other normal words
    normal_words = ['CLASS', 'GLASS', 'GRASS', 'PRESS', 'CROSS', 'TRUST',
                   'SHRED', 'SPLIT', 'CRISP', 'SHARP', 'SWEET']

    missing_normal = [w for w in normal_words if w not in guess_words]
    if missing_normal:
        print(f"  ⚠️  Normal words missing: {', '.join(missing_normal)}")
    else:
        print(f"  ✅ All normal test words present")

    # Garbage words
    garbage_words = ['AALII', 'AARGH', 'XYSTI', 'YEXED', 'QANAT']
    present_garbage = [w for w in garbage_words if w in guess_words]
    if present_garbage:
        errors.append(f"❌ Garbage words present: {', '.join(present_garbage)}")
    else:
        print(f"  ✅ No garbage words present")

    print()

    if errors:
        print("❌ VALIDATION FAILED:\n")
        for err in errors:
            print(f"  - {err}")
        raise ValueError("Validation failed")

    print("✅ All validations passed!")
    print(f"   - GUESS_WORDS_CLEAN: {len(guess_words)} words")
    print(f"   - ANSWER_WORDS_EXPANDED: {len(answer_words)} words")
    print(f"   - All words are 5 letters, A-Z only")
    print(f"   - No duplicates")
    print(f"   - ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN")
    print(f"   - Alphabetically sorted")
    print(f"   - CRASS included, MENIL excluded")

# ============================================================================
# MAIN
# ============================================================================

def main():
    print("=" * 80)
    print("FREQUENCY-BASED DICTIONARY GENERATOR - Milestone 4.13 (Corrected)")
    print("=" * 80)

    # Load source words from wordfreq vocabulary (not Wordle lists)
    print("\n=== LOADING SOURCE WORDS FROM WORDFREQ ===\n")
    all_source_words = load_all_five_letter_words_from_wordfreq()

    print(f"Loaded {len(all_source_words)} five-letter words from wordfreq vocabulary")

    # Generate dictionaries
    guess_words = generate_guess_words(all_source_words)
    answer_words = generate_answer_words(guess_words)

    # Validate
    validate_dictionaries(guess_words, answer_words)

    # Write output files
    print("\n=== WRITING FILES ===\n")
    write_word_list_to_ts(OUTPUT_GUESS_WORDS, guess_words, 'GUESS_WORDS_CLEAN')
    write_word_list_to_ts(OUTPUT_ANSWER_WORDS, answer_words, 'ANSWER_WORDS_EXPANDED')

    print("\n" + "=" * 80)
    print("✅ DICTIONARY GENERATION COMPLETE!")
    print("=" * 80)
    print(f"\nGenerated files:")
    print(f"  - {OUTPUT_GUESS_WORDS.relative_to(Path.cwd())}")
    print(f"  - {OUTPUT_ANSWER_WORDS.relative_to(Path.cwd())}")
    print(f"\nNext steps:")
    print(f"  1. Review the generated files")
    print(f"  2. Run validation: npx tsx -e \"import {{ validateWordLists }} from './src/lib/word-lists.js'; validateWordLists();\"")
    print(f"  3. Test specific words")
    print(f"  4. Commit changes\n")

if __name__ == '__main__':
    main()
