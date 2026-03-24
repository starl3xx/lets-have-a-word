import { GetServerSideProps } from 'next';
import Head from 'next/head';

/**
 * Dynamic share page — exists solely for its OG meta tags.
 *
 * When Farcaster's crawler hits /share/CUTIE?round=24&jackpot=0.0200&guesses=22&players=14,
 * it reads the og:image pointing to our dynamic image endpoint.
 * Human visitors get redirected to the main game page.
 */

interface SharePageProps {
  word: string;
  round: string;
  jackpot: string;
  guesses: string;
  players: string;
  ogImageUrl: string;
}

export const getServerSideProps: GetServerSideProps<SharePageProps> = async (context) => {
  const { word } = context.params as { word: string };
  const q = context.query;
  const first = (v: string | string[] | undefined, fallback: string) =>
    Array.isArray(v) ? v[0] || fallback : v || fallback;
  const round = first(q.round, '1');
  const jackpot = first(q.jackpot, '0.0200');
  const guesses = first(q.guesses, '0');
  const players = first(q.players, '0');

  const safeWord = (word || 'HELLO').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://letshaveaword.fun';
  const ogImageUrl = `${baseUrl}/api/og/share?word=${safeWord}&round=${encodeURIComponent(round)}&jackpot=${encodeURIComponent(jackpot)}&guesses=${encodeURIComponent(guesses)}&players=${encodeURIComponent(players)}`;

  // Detect if this is a crawler (no user-agent or known bot patterns)
  const ua = (context.req.headers['user-agent'] || '').toLowerCase();
  const isCrawler = !ua || /bot|crawl|spider|farcaster|twitter|facebook|slack|discord|telegram|whatsapp|preview|fetch/i.test(ua);

  // Redirect human visitors to the game
  if (!isCrawler) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }

  return {
    props: {
      word: safeWord,
      round,
      jackpot,
      guesses,
      players,
      ogImageUrl,
    },
  };
};

export default function SharePage({ word, round, jackpot, ogImageUrl }: SharePageProps) {
  const title = `\u201c${word}\u201d eliminated \u2014 Round #${round} | Let\u2019s Have A Word`;
  const description = `${jackpot} ETH jackpot is still up for grabs. Find the word. Win the prize.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="800" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://letshaveaword.fun`} />
        <meta name="fc:miniapp" content={JSON.stringify({
          version: "1",
          imageUrl: ogImageUrl,
          button: {
            title: "Play now",
            action: {
              type: "launch_frame",
              name: "Let\u2019s Have A Word!",
              url: "https://letshaveaword.fun",
              splashImageUrl: "https://letshaveaword.fun/LHAW-splash.png",
              splashBackgroundColor: "#8c81a8"
            }
          }
        })} />
        <meta name="fc:frame" content={JSON.stringify({
          version: "1",
          imageUrl: ogImageUrl,
          button: {
            title: "Play now",
            action: {
              type: "launch_frame",
              name: "Let\u2019s Have A Word!",
              url: "https://letshaveaword.fun",
              splashImageUrl: "https://letshaveaword.fun/LHAW-splash.png",
              splashBackgroundColor: "#8c81a8"
            }
          }
        })} />
      </Head>
      <div />
    </>
  );
}
