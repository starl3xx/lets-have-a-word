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
        {/* Viewport meta tag for iOS Safari safe area support */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        {/* Open Graph meta tags for rich embeds */}
        <meta property="og:title" content="Let's Have A Word!" />
        <meta property="og:description" content="A global word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot" />
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
