import { Html, Head, Main, NextScript } from 'next/document';

// Farcaster Mini App embed metadata (must be stringified JSON)
const fcFrameEmbed = JSON.stringify({
  version: "1",
  imageUrl: "https://www.letshaveaword.fun/LHAW-hero3.png",
  button: {
    title: "Play now",
    action: {
      type: "launch_frame",
      name: "Let's Have A Word!",
      url: "https://letshaveaword.fun",
      splashImageUrl: "https://www.letshaveaword.fun/LHAW-splash.png",
      splashBackgroundColor: "#8c81a8"
    }
  }
});

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Favicon: the 192px variant, not the 291 KB 1024px original, which
            exists for the Farcaster manifest iconUrl (that one must stay
            1024x1024). */}
        <link rel="icon" type="image/png" href="/LHAW-icon-192.png" />
        <link rel="apple-touch-icon" href="/LHAW-icon-192.png" />
        {/* Base App verification */}
        <meta name="base:app_id" content="695205f8c63ad876c90817af" />
        {/* Viewport meta tag for iOS Safari safe area support */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        {/* Open Graph meta tags for rich embeds */}
        <meta property="og:title" content="Let's Have A Word!" />
        {/* Currency-neutral: this is the description on every embed of the site,
            and it outlives any one era of the prize pool. splash.tsx already said
            "the jackpot" — this was the copy that still said ETH. */}
        <meta property="og:description" content="A global word hunt where everyone eliminates wrong answers until one player hits the jackpot" />
        <meta property="og:image" content="https://www.letshaveaword.fun/LHAW-hero3.png" />
        <meta property="og:url" content="https://letshaveaword.fun" />
        <meta property="og:type" content="website" />
        {/* Farcaster Mini App embed for rich sharing */}
        <meta name="fc:miniapp" content={fcFrameEmbed} />
        {/* Backward compatibility for older Farcaster clients */}
        <meta name="fc:frame" content={fcFrameEmbed} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
