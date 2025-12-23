#!/usr/bin/env python3
"""
Missing Words Finder - Identifies common 5-letter words not in our word list

Uses multiple sources to find potentially missing words:
1. Datamuse API - Related words and common vocabulary
2. Pattern-based generation - Common word patterns
3. Category-based search - Animals, foods, verbs, etc.

Usage:
    python3 src/scripts/find-missing-words.py
"""

import re
import json
import urllib.request
import urllib.parse
import time
from pathlib import Path
from typing import Set, List, Dict

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / 'data'
WORD_LIST_FILE = DATA_DIR / 'guess_words_clean.ts'
OUTPUT_FILE = DATA_DIR / 'missing_candidates.ts'

# Datamuse API (free, no auth required)
DATAMUSE_API = "https://api.datamuse.com/words"

# ============================================================================
# LOAD CURRENT WORD LIST
# ============================================================================

def load_current_words() -> Set[str]:
    """Load all words from our current word list"""
    content = WORD_LIST_FILE.read_text()
    words = set(re.findall(r'"([A-Z]{5})"', content))
    print(f"Loaded {len(words)} words from current word list")
    return words

# ============================================================================
# DATAMUSE API HELPERS
# ============================================================================

def query_datamuse(params: Dict) -> List[str]:
    """Query Datamuse API and return 5-letter words"""
    params['max'] = 1000  # Get many results
    url = f"{DATAMUSE_API}?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode())
            # Filter to exactly 5 letters, alphabetic only
            words = [
                item['word'].upper()
                for item in data
                if len(item['word']) == 5 and item['word'].isalpha()
            ]
            return words
    except Exception as e:
        print(f"  API error: {e}")
        return []

def search_by_pattern(pattern: str) -> List[str]:
    """Search for words matching a pattern (? = single letter)"""
    return query_datamuse({'sp': pattern})

def search_by_meaning(hint: str) -> List[str]:
    """Search for words related to a meaning/topic"""
    return query_datamuse({'ml': hint})

def search_by_rhyme(word: str) -> List[str]:
    """Search for words that rhyme with given word"""
    return query_datamuse({'rel_rhy': word})

def search_by_sound(word: str) -> List[str]:
    """Search for words that sound like given word"""
    return query_datamuse({'sl': word})

def search_frequent() -> List[str]:
    """Get frequently used 5-letter words"""
    # Datamuse doesn't have a direct frequency endpoint, but we can
    # search for words that complete common patterns
    words = set()

    # Common starting patterns
    starts = ['th', 'ch', 'sh', 'wh', 'st', 'tr', 'pr', 'cr', 'br', 'gr',
              'fl', 'pl', 'bl', 'cl', 'sp', 'sw', 'sc', 'sk', 'sl', 'sm',
              'sn', 'qu', 'dr', 'fr', 'wr']

    for start in starts:
        pattern = f"{start}???"
        results = search_by_pattern(pattern)
        words.update(results)
        time.sleep(0.1)  # Rate limiting

    return list(words)

# ============================================================================
# CATEGORY-BASED SEARCHES
# ============================================================================

CATEGORIES = {
    'animals': ['animal', 'pet', 'bird', 'fish', 'mammal', 'insect', 'dog breed', 'cat'],
    'food': ['food', 'fruit', 'vegetable', 'meat', 'dessert', 'drink', 'spice', 'cuisine'],
    'nature': ['plant', 'tree', 'flower', 'weather', 'ocean', 'mountain', 'river'],
    'body': ['body part', 'organ', 'bone', 'muscle'],
    'house': ['furniture', 'room', 'kitchen', 'tool', 'appliance'],
    'clothing': ['clothing', 'fabric', 'shoe', 'hat', 'accessory'],
    'music': ['instrument', 'music', 'song', 'dance'],
    'sports': ['sport', 'game', 'exercise', 'athlete'],
    'vehicles': ['vehicle', 'car', 'boat', 'plane'],
    'emotions': ['emotion', 'feeling', 'mood', 'happy', 'sad', 'angry'],
    'actions': ['walk', 'run', 'jump', 'throw', 'catch', 'break', 'build'],
    'colors': ['color', 'shade', 'hue'],
    'time': ['time', 'day', 'month', 'season'],
    'places': ['place', 'building', 'store', 'room'],
    'jobs': ['job', 'profession', 'worker', 'occupation'],
}

def search_categories() -> Dict[str, List[str]]:
    """Search for words in common categories"""
    results = {}

    for category, hints in CATEGORIES.items():
        print(f"  Searching category: {category}")
        category_words = set()

        for hint in hints:
            words = search_by_meaning(hint)
            category_words.update(words)
            time.sleep(0.1)  # Rate limiting

        results[category] = list(category_words)
        print(f"    Found {len(category_words)} words")

    return results

# ============================================================================
# COMMON WORD PATTERNS
# ============================================================================

def search_common_patterns() -> List[str]:
    """Search for words with common English patterns"""
    words = set()

    patterns = [
        # Common endings
        '????y', '????s', '????d', '????r', '????n', '????t', '????l',
        '???ed', '???er', '???ly', '???ty', '???ry', '???ny',
        '??ing', '??tion',
        # Common vowel patterns
        '?a?e?', '?o?e?', '?i?e?', '?u?e?',
        '?ea??', '?ou??', '?ai??', '?oo??',
        # Double letters
        '??oo?', '??ee?', '??ll?', '??ss?', '??tt?',
    ]

    print("  Searching common patterns...")
    for pattern in patterns:
        results = search_by_pattern(pattern)
        words.update(results)
        time.sleep(0.1)

    return list(words)

# ============================================================================
# RHYME-BASED DISCOVERY
# ============================================================================

def search_rhymes() -> List[str]:
    """Find words by rhyming with common words"""
    words = set()

    # Common rhyme families
    seed_words = [
        'make', 'take', 'lake', 'cake',  # -ake
        'light', 'night', 'right', 'sight',  # -ight
        'round', 'sound', 'found', 'ground',  # -ound
        'old', 'gold', 'cold', 'hold',  # -old
        'rain', 'train', 'brain', 'plain',  # -ain
        'dream', 'team', 'cream', 'steam',  # -eam
        'stone', 'phone', 'bone', 'tone',  # -one
        'blue', 'true', 'clue', 'glue',  # -ue
        'best', 'test', 'rest', 'nest',  # -est
        'park', 'dark', 'mark', 'shark',  # -ark
    ]

    print("  Searching rhyme families...")
    for seed in seed_words:
        results = search_by_rhyme(seed)
        words.update(results)
        time.sleep(0.1)

    return list(words)

# ============================================================================
# MANUAL ALLOWLIST - Words we know should exist
# ============================================================================

MANUAL_CANDIDATES = [
    # Western/Ranch
    'LASSO', 'RODEO', 'RANCH', 'CORGI', 'BRONC',
    # Music
    'BANJO', 'CELLO', 'PIANO', 'VIOLA', 'POLKA',
    # Food
    'SALSA', 'MATZO', 'BAGEL', 'NACHO', 'MOCHA', 'LATTE', 'CREPE',
    # Animals
    'LLAMA', 'PANDA', 'KOALA', 'HYENA', 'ZEBRA', 'HIPPO', 'RHINO',
    # Tech/Modern
    'EMOJI', 'PIXEL', 'GAMER', 'TWEET', 'DRONE', 'CYBER', 'VIRAL',
    # Common verbs
    'KAYAK', 'SCUBA', 'SAUNA', 'DISCO', 'TANGO', 'WALTZ', 'LIMBO',
    # Places
    'PLAZA', 'VILLA', 'PATIO', 'FOYER', 'ATTIC', 'DEPOT', 'ARENA',
    # Misc common
    'NINJA', 'KARMA', 'QUOTA', 'TIARA', 'ULTRA', 'RETRO', 'INTRO',
    'MACHO', 'MOTTO', 'COMBO', 'PROMO', 'TEMPO', 'GECKO', 'GUSTO',
    # Pop culture
    'ANIME', 'MANGA', 'SUSHI', 'RAMEN', 'TOFU', 'WASABI',
]

# ============================================================================
# FILTERING
# ============================================================================

# Words that look valid but shouldn't be included
REJECT_PATTERNS = [
    r'^[BCDFGHJKLMNPQRSTVWXYZ]{5}$',  # All consonants
    r'^[AEIOU]{5}$',  # All vowels (unlikely to be real)
]

REJECT_WORDS = {
    # Offensive
    'SLUTS', 'WHORE', 'BITCH', 'CUNTS', 'FUCKS', 'SHITS', 'NIGER',
    # Proper nouns (countries, names) - we have separate lists for these
    'CHINA', 'INDIA', 'SPAIN', 'ITALY', 'JAPAN', 'KOREA', 'TEXAS',
    'JAMES', 'DAVID', 'SARAH', 'EMILY', 'MARIA',
    # Obscure/archaic
    'AALII', 'AARGH', 'ADIEU',
}

def is_valid_candidate(word: str) -> bool:
    """Check if word is a valid candidate"""
    word = word.upper()

    # Must be exactly 5 letters
    if len(word) != 5:
        return False

    # Must be alphabetic
    if not word.isalpha():
        return False

    # Check reject patterns
    for pattern in REJECT_PATTERNS:
        if re.match(pattern, word):
            return False

    # Check reject list
    if word in REJECT_WORDS:
        return False

    return True

# ============================================================================
# MAIN
# ============================================================================

def main():
    print("=" * 70)
    print("MISSING WORDS FINDER")
    print("=" * 70)

    # Load current words
    current_words = load_current_words()

    # Collect candidates from all sources
    all_candidates = set()

    # 1. Manual allowlist
    print("\n[1/5] Adding manual candidates...")
    manual = [w.upper() for w in MANUAL_CANDIDATES if is_valid_candidate(w)]
    all_candidates.update(manual)
    print(f"  Added {len(manual)} manual candidates")

    # 2. Category searches
    print("\n[2/5] Searching by category...")
    category_results = search_categories()
    for cat, words in category_results.items():
        valid = [w for w in words if is_valid_candidate(w)]
        all_candidates.update(valid)

    # 3. Common patterns
    print("\n[3/5] Searching common patterns...")
    pattern_words = search_common_patterns()
    valid_patterns = [w for w in pattern_words if is_valid_candidate(w)]
    all_candidates.update(valid_patterns)
    print(f"  Found {len(valid_patterns)} pattern words")

    # 4. Rhyme families
    print("\n[4/5] Searching rhyme families...")
    rhyme_words = search_rhymes()
    valid_rhymes = [w for w in rhyme_words if is_valid_candidate(w)]
    all_candidates.update(valid_rhymes)
    print(f"  Found {len(valid_rhymes)} rhyme words")

    # 5. Frequent word patterns
    print("\n[5/5] Searching frequent patterns...")
    freq_words = search_frequent()
    valid_freq = [w for w in freq_words if is_valid_candidate(w)]
    all_candidates.update(valid_freq)
    print(f"  Found {len(valid_freq)} frequent words")

    # Filter out words we already have
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)

    missing = all_candidates - current_words
    missing_sorted = sorted(missing)

    print(f"\nTotal candidates found: {len(all_candidates)}")
    print(f"Already in word list: {len(all_candidates & current_words)}")
    print(f"Potentially missing: {len(missing)}")

    # Categorize missing words
    print(f"\n--- MISSING WORDS ({len(missing_sorted)}) ---\n")

    # Group by first letter for easier review
    by_letter = {}
    for word in missing_sorted:
        letter = word[0]
        if letter not in by_letter:
            by_letter[letter] = []
        by_letter[letter].append(word)

    for letter in sorted(by_letter.keys()):
        words = by_letter[letter]
        print(f"{letter}: {', '.join(words)}")

    # Write to file
    print(f"\n--- Writing to {OUTPUT_FILE.name} ---")

    output_content = f'''/**
 * MISSING_CANDIDATES
 *
 * Potential words to add to the master word list.
 * Generated by find-missing-words.py
 *
 * REVIEW EACH WORD before adding to guess_words_clean.ts:
 * - Is it a real, common English word?
 * - Is it appropriate for the game?
 * - Is it too obscure or regional?
 *
 * Total candidates: {len(missing_sorted)}
 */
export const MISSING_CANDIDATES: string[] = [
'''

    output_content += ',\n'.join(f'  "{w}"' for w in missing_sorted)
    output_content += ',\n];\n'

    OUTPUT_FILE.write_text(output_content)
    print(f"Wrote {len(missing_sorted)} candidates to {OUTPUT_FILE.name}")

    # Show some highlights
    print("\n--- NOTABLE MISSING WORDS ---")
    notable = [w for w in missing_sorted if w in [x.upper() for x in MANUAL_CANDIDATES]]
    if notable:
        print(f"From manual list: {', '.join(notable[:20])}")

    print("\n" + "=" * 70)
    print("DONE - Review the candidates and add approved ones to the word list")
    print("=" * 70)

if __name__ == '__main__':
    main()
