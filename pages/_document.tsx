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
        {/* Farcaster Mini App embed for rich sharing */}
        <meta name="fc:frame" content={fcFrameEmbed} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
