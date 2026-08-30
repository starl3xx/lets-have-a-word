import { Html, Head, Main, NextScript } from 'next/document';

// Farcaster Mini App embed metadata (must be stringified JSON)
const fcFrameEmbed = JSON.stringify({
  version: "1",
  imageUrl: "https://letshaveaword.fun/LHAW-hero3.png",
  button: {
    title: "Play now",
    action: {
      type: "launch_frame",
      name: "Let's Have A Word!",
      url: "https://letshaveaword.fun",
      splashImageUrl: "https://letshaveaword.fun/LHAW-splash.png",
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
        {/* The five first-screen font weights, preloaded so cold-cache
            downloads start with the HTML instead of after the CSS parses.
            The wheel hides at opacity 0 until document.fonts.ready, so late
            fonts are a late wheel. Exactly these five: 300 (TopTicker's
            font-light labels) through 700; the italic and display weights
            load on demand. crossOrigin is required — font preloads are
            CORS-mode fetches even same-origin, and without it the preload
            is re-fetched and wasted. */}
        <link rel="preload" href="/fonts/soehne-leicht.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/soehne-buch.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/soehne-kraftig.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/soehne-halbfett.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/soehne-dreiviertelfett.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
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
        <meta property="og:image" content="https://letshaveaword.fun/LHAW-hero3.png" />
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
