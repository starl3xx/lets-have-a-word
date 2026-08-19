/**
 * Farcaster usernames are not X handles.
 *
 * The announcer writes one string for both networks. Stripping the @ on the way
 * to X has always been the safe default, and these tests pin that default in
 * place: the only thing that may restore an @ is a handle we resolved and found
 * live. Sampling 15 of the names we have tweeted found 14 live X accounts
 * belonging to other people, one with 105,653 followers.
 */
import { describe, it, expect } from 'vitest';
import { convertToTwitterText } from '../lib/twitter';
import { extractMentions } from '../lib/tweet-mentions';

describe('extractMentions', () => {
  it('finds player mentions, lowercased and deduplicated', () => {
    const text = '🎣 @WordSmith found a bonus word! Congrats @wordsmith and @sharpguess.';
    expect(extractMentions(text).sort()).toEqual(['sharpguess', 'wordsmith']);
  });

  it('ignores our own account, which has its own mapping', () => {
    expect(extractMentions('Round #40 is live in @letshaveaword')).toEqual([]);
  });

  it('ignores the @fid: placeholder the announcer emits when it cannot name somebody', () => {
    expect(extractMentions('@fid:12345 found a burn word')).toEqual([]);
  });

  it('returns nothing when there is nothing to resolve', () => {
    expect(extractMentions('The pot is now 12,000 $WORD.')).toEqual([]);
  });
});

describe('convertToTwitterText mention handling', () => {
  const cast = '🎣 @quietplayer found a bonus word and won 500 $WORD!';

  it('strips the @ when no handle is known', () => {
    expect(convertToTwitterText(cast)).toBe(
      '🎣 quietplayer found a bonus word and won 500 $WORD!'
    );
  });

  it('strips the @ when the map is empty, which is what a failed lookup returns', () => {
    expect(convertToTwitterText(cast, new Map())).toBe(
      '🎣 quietplayer found a bonus word and won 500 $WORD!'
    );
  });

  it('rewrites to the real X handle when one was resolved live', () => {
    // A player whose X handle differs from their Farcaster username, which
    // is the common case and exactly why the name cannot be reused verbatim.
    const mentions = new Map([['quietplayer', 'qp_onx']]);
    expect(convertToTwitterText(cast, mentions)).toBe(
      '🎣 @qp_onx found a bonus word and won 500 $WORD!'
    );
  });

  it('matches case-insensitively, since the map is keyed lowercased', () => {
    const mentions = new Map([['quietplayer', 'qp_onx']]);
    expect(convertToTwitterText('@Quietplayer won', mentions)).toBe('@qp_onx won');
  });

  it('still maps our own handle, and never through the player map', () => {
    const mentions = new Map([['letshaveaword', 'somebody_else']]);
    expect(convertToTwitterText('Play at @letshaveaword', mentions)).toBe(
      'Play at @letshaveaword_'
    );
  });

  it('handles a mixed cast, resolving one player and stripping the other', () => {
    const mentions = new Map([['sharpguess', 'sharpguess']]);
    const out = convertToTwitterText('@sharpguess beat @quietplayer to it', mentions);
    expect(out).toBe('@sharpguess beat quietplayer to it');
  });
});
