import { useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';

interface FAQSheetProps {
  onClose: () => void;
}

interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

/**
 * FAQSheet Component
 * Milestone 4.3, Updated Milestone 7.0
 *
 * Displays comprehensive FAQ covering all game mechanics
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent typography and spacing
 */
export default function FAQSheet({ onClose }: FAQSheetProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleQuestion = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  // Helper to create clickable $WORD token link
  const WordTokenLink = ({ children }: { children: React.ReactNode }) => (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          console.log('[FAQ] Attempting to view token...');
          const result = await sdk.actions.viewToken({
            token: 'eip155:8453/erc20:0x304e649e69979298BD1AEE63e175ADf07885fb4b'
          });
          console.log('[FAQ] viewToken result:', result);
        } catch (error) {
          console.error('[FAQ] Error opening token view:', error);
        }
      }}
      className="text-accent-600 hover:text-accent-800 font-semibold transition-colors duration-fast"
    >
      {children}
    </button>
  );

  // Helper to create clickable Farcaster profile link
  const ProfileLink = ({ fid, children }: { fid: number; children: React.ReactNode }) => (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await sdk.actions.viewProfile({ fid });
        } catch (error) {
          console.error('Error opening profile:', error);
        }
      }}
      className="text-accent-600 hover:text-accent-800 font-semibold transition-colors duration-fast"
    >
      {children}
    </button>
  );

  const FAQ_DATA: FAQItem[] = [
    {
      question: "How does the game work?",
      answer: (
        <>
          Every <strong>Let's Have A Word!</strong> player worldwide is hunting the same secret 5-letter word. Every incorrect guess helps everyone else by removing that word from play.
          <p className="mt-2">The <strong>prize pool</strong> is the total ETH collected during a round as players purchase guess packs. When someone guesses correctly, the round ends and the <strong>jackpot</strong> — the winner's share of the prize pool — is paid out automatically onchain. A new round then starts with a new secret word.</p>
        </>
      ),
    },
    {
      question: "Can I see the word after someone wins?",
      answer: (
        <>
          <strong>Yes.</strong> When a round is won, the secret word is revealed publicly by <ProfileLink fid={1477413}>@letshaveaword</ProfileLink>.
          <p className="mt-2">
            You can view all past winning words, round details, and payouts in the{" "}
            <a href="https://letshaveaword.fun/archive" target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:text-accent-800 underline">Round Archive</a>.
          </p>
          <p className="mt-2">
            You can also independently verify each round's cryptographic commitment and reveal at{" "}
            <a href="https://letshaveaword.fun/verify" target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:text-accent-800 underline">letshaveaword.fun/verify</a>.
          </p>
        </>
      ),
    },
    {
      question: 'What does "provably fair" mean?',
      answer: (
        <>
          Before each round begins, Let's Have A Word <strong>commits onchain</strong> to the secret word using a cryptographic hash and hidden salt.
          <p className="mt-2">This commitment guarantees that the <strong>word cannot be changed mid-round</strong> — not by the game, not by the creator, not by anyone. Importantly, <strong>the creator does not know the secret word while the round is live</strong>. The word is only revealed after someone finds it.</p>
          <p className="mt-2">When a round ends:</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>The secret word and salt are revealed by <ProfileLink fid={1477413}>@letshaveaword</ProfileLink></li>
            <li>Anyone can recompute the hash</li>
            <li>Anyone can verify the answer was fixed from the very start</li>
          </ul>
          <p className="mt-2">You don't have to trust this; you can verify every round yourself at <a href="https://letshaveaword.fun/verify" target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:text-accent-800 underline">letshaveaword.fun/verify</a></p>
          <p className="mt-2">This commit–reveal process makes every round transparent, verifiable, and fair.</p>
        </>
      ),
    },
    {
      question: "What are free guesses?",
      answer: (
        <>
          Every player gets <strong>1 free guess per day</strong>. Free guesses don't cost anything (obvs) but can still win the jackpot. Free guesses <strong>are</strong> counted in the Top 10 Early Guessers ranking.
          <p className="mt-2">Free guesses reset daily at <strong>11:00 UTC</strong>.</p>
        </>
      ),
    },
    {
      question: "How do I get more guesses?",
      answer: (
        <>
          You can earn bonus free guesses by:
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>Sharing your daily guess on Farcaster (+1 guess/day)</li>
            <li>Holding <WordTokenLink>$WORD</WordTokenLink> tokens (+1 to +3 guesses/day depending on balance and market cap tier)</li>
          </ol>
          <p className="mt-2">You can also purchase paid guess packs (3 guesses per pack, unlimited purchases with volume-based pricing).</p>
        </>
      ),
    },
    {
      question: "What is $WORD?",
      answer: (
        <>
          <WordTokenLink>$WORD</WordTokenLink> is the native token of Let's Have A Word. It powers the game's economy through holder bonuses, burn mechanics, and staking rewards.
          <p className="mt-2">Tap the <strong>$WORD</strong> button in the nav bar to view your balance, staking, and tokenomics.</p>
        </>
      ),
    },
    {
      question: "How do $WORD holder tiers work?",
      answer: (
        <>
          Holding <WordTokenLink>$WORD</WordTokenLink> tokens gives you bonus free guesses every day. The number of bonus guesses depends on your <strong>balance</strong> and the <strong>current market cap</strong>:
          <p className="mt-2"><strong>When market cap is below $150K:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>100M tokens → <strong>+1 guess/day</strong> (Tier 1)</li>
            <li>200M tokens → <strong>+2 guesses/day</strong> (Tier 2)</li>
            <li>300M tokens → <strong>+3 guesses/day</strong> (Tier 3)</li>
          </ul>
          <p className="mt-2"><strong>When market cap is $150K–$300K:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>50M → +1, 100M → +2, 150M → +3</li>
          </ul>
          <p className="mt-2"><strong>When market cap is above $300K:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>25M → +1, 50M → +2, 75M → +3</li>
          </ul>
          <p className="mt-2">Staked tokens count toward your effective balance. Market cap is updated every 15 minutes via a live onchain oracle.</p>
        </>
      ),
    },
    {
      question: "How does the share bonus work?",
      answer: (<>Share your guess on Farcaster or Base <strong>once per day</strong> to earn <strong>+1 free guess</strong>. The bonus is applied automatically after you cast.</>),
    },
    {
      question: "How are paid guesses different?",
      answer: (
        <>
          Paid guesses:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Cost ETH</li>
            <li>Increase the global prize pool</li>
            <li>Can be used anytime within the daily window (until the 11:00 UTC reset), even if a new round starts</li>
          </ul>
        </>
      ),
    },
    {
      question: "How much do guess packs cost?",
      answer: (
        <>
          Each pack contains <strong>3 guesses</strong>. Pricing has two components:
          <p className="mt-2"><strong>Stage-based pricing</strong> (based on total guesses in round):</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>0–849 guesses (early): 0.00030 ETH base</li>
            <li>850–1249 guesses (mid): 0.00045 ETH base</li>
            <li>1250+ guesses (late): 0.00060 ETH base</li>
          </ul>
          <p className="mt-2"><strong>Volume-based multipliers</strong> (based on daily purchases):</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Packs 1–3: 1× base price</li>
            <li>Packs 4–6: 1.5× base price</li>
            <li>Packs 7+: 2× base price</li>
          </ul>
          <p className="mt-2">Pack purchases are <strong>unlimited</strong> — there's no daily cap. Volume multipliers reset at 11:00 UTC along with paid guess expiration.</p>
        </>
      ),
    },
    {
      question: "What happens to my unused guesses?",
      answer: (
        <ul className="list-disc list-inside space-y-1">
          <li>Free guesses reset daily at <strong>11:00 UTC</strong></li>
          <li>Paid guess credits expire at the end of each day (<strong>11:00 UTC</strong>)</li>
          <li>If a round ends and a new round starts on the same day, unused paid guesses carry over</li>
        </ul>
      ),
    },
    {
      question: "How is the prize pool split?",
      answer: (
        <>
          When a round is won, the prize pool is distributed atomically onchain in a single transaction:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><strong>80%</strong> → Jackpot winner</li>
            <li><strong>10%</strong> → Top 10 Early Guessers</li>
            <li><strong>5%</strong> → Referrer (if one exists)</li>
            <li><strong>5%</strong> → Next round seed</li>
          </ul>
          <p className="mt-2">If the winner <strong>does not</strong> have a referrer:</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li><strong>2.5%</strong> of the referrer share is added to the Top 10 pool</li>
            <li><strong>2.5%</strong> is added to the next round seed</li>
            <li>Next round seed is capped at 0.03 ETH</li>
            <li>Any overflow above the cap goes to the treasury</li>
          </ul>
          <p className="mt-2">Self-referrals are blocked. Null or zero referrers are treated as "no referrer."</p>
        </>
      ),
    },
    {
      question: "How do Top 10 rewards work?",
      answer: (
        <>
          Top 10 rewards are based on <strong>early participation</strong> in each round.
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Only the first <strong>850 guesses</strong> in a round are eligible for Top 10 ranking</li>
            <li>After guess #850, Top 10 locks</li>
            <li>Guesses after the lock can still win the jackpot, but do not affect Top 10 ranking</li>
          </ul>
          <p className="mt-2">This incentivizes early guess purchasing during the high-uncertainty phase of the round and helps drive prize pool growth.</p>
          <p className="mt-2"><strong>Even if you don't win the jackpot, heavy participation can still pay.</strong></p>
        </>
      ),
    },
    {
      question: "How are Top 10 rewards split?",
      answer: (
        <>
          The Top 10 pool is split using fixed percentages:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Rank #1: 19%</li>
            <li>Rank #2: 16%</li>
            <li>Rank #3: 14%</li>
            <li>Rank #4: 11%</li>
            <li>Rank #5: 10%</li>
            <li>Ranks #6–10: 6% each</li>
          </ul>
          <p className="mt-2">This distribution is fixed and always applies when a round is resolved, scaling proportionally with the total Top 10 pool.</p>
        </>
      ),
    },
    {
      question: "How do referrals work?",
      answer: (
        <>
          Share your unique referral link with friends or on the timeline. If anyone who joins using your link <strong>ever wins a jackpot</strong>, you'll automatically receive <strong>5% of that round's prize pool</strong>.
          <p className="mt-2">You can track your referrals and earnings in the Refer sheet.</p>
        </>
      ),
    },
    {
      question: "Why can't I play? / What are the eligibility requirements?",
      answer: (
        <>
          To prevent bot abuse, players must meet a minimum <strong>Neynar user score of 0.55 or higher</strong>. This score reflects account authenticity based on factors like onchain activity, social connections, and account history.
          <p className="mt-2">If your score is below the required threshold, you won't be able to submit guesses or purchase packs, and you'll see a message explaining the restriction.</p>
          <p className="mt-2">
            <a
              href="https://docs.neynar.com/docs/neynar-user-quality-score#faqs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-600 hover:text-accent-800 underline"
            >
              Learn more about Neynar user scores and how to improve them →
            </a>
          </p>
        </>
      ),
    },
    {
      question: "How many possible words are there?",
      answer: (
        <>
          Let's Have A Word uses a custom list of <strong>4,438</strong> five-letter words.
          <p className="mt-2">This list is curated by the game's creator and is not the same as Wordle's or any other off-the-shelf word list. Unlike Wordle, which uses separate lists for answers and valid guesses, Let's Have A Word uses a single canonical list.</p>
          <p className="mt-2">While there are 12,000+ five-letter entries if you include every possible dictionary term, most of those are obscure or non-standard. The game's list is intentionally curated to keep gameplay fair, challenging, and fun (have you found any easter eggs?).</p>
        </>
      ),
    },
    {
      question: "What is XP for?",
      answer: "XP is tracked but currently has no gameplay effect. Future updates may introduce leaderboards, progression, or XP-based rewards. I don't really know yet, tbh.",
    },
    {
      question: "What are Wordmarks?",
      answer: (
        <>
          <strong>Wordmarks</strong> are permanent achievements earned by playing Let's Have A Word! They appear next to your name in leaderboards and game lists.
          <p className="mt-2">Wordmarks you can earn:</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><strong>🕵️‍♂️ OG Hunter</strong> — Participated in the OG Hunter prelaunch campaign</li>
            <li><strong>🎣 Side Quest</strong> — Found a bonus word during a round</li>
            <li><strong>🔥 Arsonist</strong> — Found a burn word during a round</li>
            <li><strong>🏆 Jackpot Winner</strong> — Won a round jackpot</li>
            <li><strong>✌️ Double Dub</strong> — Found two bonus words OR bonus word + secret word in the same round</li>
            <li><strong>🤝 Patron</strong> — Someone you referred won a jackpot (you received the referrer payout)</li>
            <li><strong>⚡ Quickdraw</strong> — Placed in the Top 10 Early Guessers</li>
            <li><strong>📚 Encyclopedic</strong> — Guessed words starting with every letter A–Z</li>
            <li><strong>🍩 Baker's Dozen</strong> — Earned by guessing words starting with 13 different letters, on 13 different days. Only the <em>first guess of each day</em> counts toward progress.</li>
          </ul>
          <p className="mt-2">View your wordmarks collection in your Stats sheet under <strong>Lexicon</strong>.</p>
        </>
      ),
    },
    {
      question: "What are bonus words?",
      answer: (
        <>
          Each round has <strong>10 hidden bonus words</strong>, randomly selected from the full word list. If your guess matches one, you receive <strong>5M <WordTokenLink>$WORD</WordTokenLink> tokens</strong> (or 2.5M when market cap is above $150K) sent directly to your wallet, plus <strong>+250 XP</strong> and the <strong>Side Quest</strong> wordmark.
          <p className="mt-2">Bonus words are committed onchain as keccak256 hashes before the round starts, so they can't be changed mid-round. The contract verifies your guess against the committed hash before releasing tokens.</p>
        </>
      ),
    },
    {
      question: "What are burn words?",
      answer: (
        <>
          Each round has <strong>5 hidden burn words</strong>, randomly selected from the full word list. When you guess a burn word, <strong>5M $WORD tokens are permanently destroyed</strong> (burned), reducing the total supply forever. You don't receive any $WORD for finding one, but you earn <strong>+100 XP</strong> and the <strong>Arsonist</strong> wordmark.
          <p className="mt-2">Like bonus words, burn words are committed onchain as keccak256 hashes before the round starts. The contract verifies the word before executing the burn.</p>
        </>
      ),
    },
    {
      question: "What is $WORD staking?",
      answer: (
        <>
          Staking lets you lock your <WordTokenLink>$WORD</WordTokenLink> tokens in the WordManager contract to earn staking rewards over time.
          <p className="mt-2">Staked tokens count toward your <strong>effective balance</strong> for holder tier calculations, so staking can help you reach a higher bonus tier without buying more tokens.</p>
          <p className="mt-2">Manage staking from the $WORD sheet (tap 💰 $WORD in the nav).</p>
        </>
      ),
    },
    {
      question: "Do top 10 players earn $WORD too?",
      answer: (
        <>
          <strong>Yes!</strong> In addition to ETH payouts, the Top 10 Early Guessers receive <WordTokenLink>$WORD</WordTokenLink> token rewards distributed via the WordManager contract.
          <p className="mt-2">The $WORD Top 10 distribution follows the same ranking percentages as ETH (19% for #1, 16% for #2, etc.), with the total pool amount scaling with market cap.</p>
        </>
      ),
    },
    {
      question: "How does the $WORD fee distribution work?",
      answer: (
        <>
          The <WordTokenLink>$WORD</WordTokenLink> ecosystem has a built-in fee structure:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><strong>50%</strong> → Game Treasury (operations, development)</li>
            <li><strong>25%</strong> → Buyback &amp; Stake (market support)</li>
            <li><strong>15%</strong> → Player Rewards (bonus/burn/top 10)</li>
            <li><strong>10%</strong> → Top 10 Referral rewards</li>
          </ul>
          <p className="mt-2">View the full tokenomics breakdown in the $WORD sheet.</p>
        </>
      ),
    },
    {
      question: "How do I buy $WORD?",
      answer: (
        <>
          Tap the <strong>Buy $WORD</strong> button in the $WORD sheet. If you're playing in a Farcaster client, this opens the native token swap interface. Otherwise, it opens DexScreener where you can swap on Base.
          <p className="mt-2"><WordTokenLink>$WORD</WordTokenLink> is an ERC-20 token on Base (address: 0x304e...fb4b).</p>
        </>
      ),
    },
    {
      question: "Can I play outside of Farcaster?",
      answer: (
        <>
          Let's Have A Word! uses the Farcaster stack. You can play in Farcaster clients and the Base app, which share the same identity and wallet infrastructure.
          <p className="mt-2">Standalone web play isn't supported yet. A standalone web version may be explored later.</p>
        </>
      ),
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4">
          <h2 className="text-2xl font-bold text-gray-900">FAQ</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close">
            ×
          </button>
        </div>

        {/* FAQ Items */}
        <div className="space-y-2">
          {FAQ_DATA.map((item, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-btn overflow-hidden"
            >
              {/* Question */}
              <button
                onClick={() => toggleQuestion(index)}
                className="w-full text-left p-4 bg-gray-50 hover:bg-gray-100 transition-colors duration-fast flex items-center justify-between"
              >
                <span className="font-medium text-gray-900 text-sm pr-2">
                  {item.question}
                </span>
                <span className="text-gray-500 text-xl flex-shrink-0">
                  {expandedIndex === index ? '−' : '+'}
                </span>
              </button>

              {/* Answer (collapsible) */}
              {expandedIndex === index && (
                <div className="p-4 bg-white border-t border-gray-200">
                  <div className="text-sm text-gray-700 leading-relaxed">
                    {item.answer}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Close Button */}
        <button onClick={onClose} className="btn-secondary w-full mt-4">
          Close
        </button>
      </div>
    </div>
  );
}
