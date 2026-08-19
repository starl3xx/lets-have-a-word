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

  /**
   * 8,421 of our 26,338 usernames are not plain word characters: 7,442 end in
   * .eth or .base.eth, 742 carry a hyphen, and 7,159 run past the 15 characters
   * an X handle may be. Capturing a prefix of those is worse than missing them,
   * because the prefix is somebody else's name.
   */
  it('captures a dotted name whole, not just its prefix', () => {
    expect(extractMentions('@dianbetty2461.base.eth found it')).toEqual([
      'dianbetty2461.base.eth',
    ]);
  });

  it('captures hyphens and names longer than an X handle may be', () => {
    expect(extractMentions('@some-very-long-player-name won')).toEqual([
      'some-very-long-player-name',
    ]);
  });

  it('does not swallow a full stop that ends the sentence', () => {
    expect(extractMentions('Well played @wordsmith.')).toEqual(['wordsmith']);
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

  it('replaces a dotted name entirely, leaving no fragment welded to the handle', () => {
    // The bug this guards: matching only the \w prefix rewrote
    // "@dianbetty2461.base.eth" to "@theirhandle.base.eth", which is a live
    // account belonging to nobody the cast mentioned.
    const mentions = new Map([['dianbetty2461.base.eth', 'realhandle']]);
    expect(convertToTwitterText('@dianbetty2461.base.eth found it', mentions)).toBe(
      '@realhandle found it'
    );
  });

  it('strips a dotted name whole when no handle is known', () => {
    expect(convertToTwitterText('@dianbetty2461.base.eth found it')).toBe(
      'dianbetty2461.base.eth found it'
    );
  });

  it('does not rewrite a player whose name merely starts with ours', () => {
    expect(convertToTwitterText('@letshaveaword.eth played')).toBe('letshaveaword.eth played');
  });

  it('handles a mixed cast, resolving one player and stripping the other', () => {
    const mentions = new Map([['sharpguess', 'sharpguess']]);
    const out = convertToTwitterText('@sharpguess beat @quietplayer to it', mentions);
    expect(out).toBe('@sharpguess beat quietplayer to it');
  });
});
