import { ImageResponse } from '@vercel/og';
import type { NextApiRequest, NextApiResponse } from 'next';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load Soehne TTF fonts at module level (cached across invocations in warm lambdas)
// Satori requires TTF/OTF — woff2 is not supported
const soehneBold = readFileSync(
  join(process.cwd(), 'public/fonts/soehne-fett.ttf')
);
const soehneSemibold = readFileSync(
  join(process.cwd(), 'public/fonts/soehne-halbfett.ttf')
);
const soehneBook = readFileSync(
  join(process.cwd(), 'public/fonts/soehne-buch.ttf')
);

// Load W logo as base64 data URI (128x128 resized version for OG images)
const logoBuffer = readFileSync(
  join(process.cwd(), 'public/LHAW-icon-og.png')
);
const logoDataUri = `data:image/png;base64,${logoBuffer.toString('base64')}`;

function asString(val: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(val)) return val[0] || fallback;
  return val || fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const word = asString(req.query.word, 'HELLO').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  const round = asString(req.query.round, '1');
  const jackpot = asString(req.query.jackpot, '0.0200');
  const guesses = asString(req.query.guesses, '0');
  const players = asString(req.query.players, '0');

  const letters = word.split('');

  const imageResponse = new ImageResponse(
    (
      <div
        style={{
          width: '1200',
          height: '630',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: '80px',
          background: 'radial-gradient(ellipse at 50% 45%, #efe9ff 0%, #e5ddfb 50%, #dbd2f7 100%)',
          fontFamily: 'Soehne',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Scattered background letters */}
        <div style={{ position: 'absolute', top: '15px', left: '40px', fontSize: '68px', fontWeight: 700, color: '#111827', opacity: 0.03 }}>W</div>
        <div style={{ position: 'absolute', top: '80px', right: '70px', fontSize: '58px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>H</div>
        <div style={{ position: 'absolute', bottom: '100px', left: '80px', fontSize: '74px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>A</div>
        <div style={{ position: 'absolute', top: '170px', left: '20px', fontSize: '50px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>R</div>
        <div style={{ position: 'absolute', bottom: '55px', right: '40px', fontSize: '62px', fontWeight: 700, color: '#111827', opacity: 0.03 }}>D</div>
        <div style={{ position: 'absolute', top: '30px', left: '280px', fontSize: '44px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>G</div>
        <div style={{ position: 'absolute', bottom: '130px', right: '250px', fontSize: '48px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>E</div>
        <div style={{ position: 'absolute', top: '110px', right: '270px', fontSize: '54px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>S</div>
        <div style={{ position: 'absolute', bottom: '25px', left: '320px', fontSize: '40px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>L</div>
        <div style={{ position: 'absolute', top: '10px', right: '320px', fontSize: '50px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>T</div>
        <div style={{ position: 'absolute', bottom: '150px', left: '15px', fontSize: '46px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>O</div>
        <div style={{ position: 'absolute', top: '190px', right: '20px', fontSize: '42px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>N</div>
        <div style={{ position: 'absolute', top: '55px', left: '160px', fontSize: '52px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>F</div>
        <div style={{ position: 'absolute', top: '140px', left: '110px', fontSize: '38px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>I</div>
        <div style={{ position: 'absolute', bottom: '180px', right: '120px', fontSize: '56px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>P</div>
        <div style={{ position: 'absolute', top: '10px', left: '480px', fontSize: '46px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>C</div>
        <div style={{ position: 'absolute', bottom: '70px', left: '200px', fontSize: '42px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>M</div>
        <div style={{ position: 'absolute', top: '60px', right: '160px', fontSize: '60px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>B</div>
        <div style={{ position: 'absolute', bottom: '40px', right: '180px', fontSize: '36px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>K</div>
        <div style={{ position: 'absolute', top: '200px', left: '170px', fontSize: '44px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>V</div>
        <div style={{ position: 'absolute', bottom: '190px', left: '260px', fontSize: '38px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>U</div>
        <div style={{ position: 'absolute', top: '35px', right: '450px', fontSize: '40px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>J</div>
        <div style={{ position: 'absolute', bottom: '120px', right: '380px', fontSize: '50px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>X</div>
        <div style={{ position: 'absolute', top: '160px', right: '140px', fontSize: '36px', fontWeight: 700, color: '#111827', opacity: 0.025 }}>Y</div>
        <div style={{ position: 'absolute', bottom: '10px', left: '50px', fontSize: '52px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>Z</div>
        <div style={{ position: 'absolute', top: '5px', right: '180px', fontSize: '34px', fontWeight: 700, color: '#111827', opacity: 0.02 }}>Q</div>
        {/* W Logo */}
        <img
          src={logoDataUri}
          style={{
            width: '68px',
            height: '68px',
            marginBottom: '10px',
            borderRadius: '12px',
          }}
        />

        {/* Round info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            marginBottom: '2px',
          }}
        >
          <span
            style={{
              fontSize: '40px',
              fontWeight: 700,
              color: '#111827',
            }}
          >
            Round #{round}
          </span>
        </div>

        {/* Prize pool */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '12px',
            marginBottom: '22px',
          }}
        >
          <span
            style={{
              fontSize: '38px',
              fontWeight: 700,
              color: '#16a34a',
              lineHeight: '1',
            }}
          >
            {parseFloat(jackpot).toFixed(4)} ETH
          </span>
          <span
            style={{
              fontSize: '30px',
              fontWeight: 400,
              color: '#6b7280',
              lineHeight: '1',
              position: 'relative',
              top: '-2px',
            }}
          >
            prize pool
          </span>
        </div>

        {/* ELIMINATED label */}
        <div
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: '#ef4444',
            letterSpacing: '6px',
            marginBottom: '14px',
          }}
        >
          ELIMINATED
        </div>

        {/* Letter tiles */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '30px',
          }}
        >
          {letters.map((letter, i) => (
            <div
              key={i}
              style={{
                width: '120px',
                height: '120px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ffffff',
                border: '7px solid #3b82f6',
                borderRadius: '10px',
                boxShadow: '0 0 0 4px rgba(147, 197, 253, 0.55), 0 6px 12px -2px rgba(0, 0, 0, 0.15), 0 3px 5px -2px rgba(0, 0, 0, 0.08)',
                fontSize: '64px',
                fontWeight: 700,
                color: '#111827',
              }}
            >
              {letter}
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            gap: '22px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              backgroundColor: 'rgba(255, 255, 255, 0.6)',
              borderRadius: '9999px',
              padding: '10px 24px',
            }}
          >
            <span style={{ fontSize: '26px', fontWeight: 700, color: '#111827' }}>
              {parseInt(guesses).toLocaleString()}
            </span>
            <span style={{ fontSize: '24px', fontWeight: 400, color: '#6b7280' }}>
              guesses
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              backgroundColor: 'rgba(255, 255, 255, 0.6)',
              borderRadius: '9999px',
              padding: '10px 24px',
            }}
          >
            <span style={{ fontSize: '26px', fontWeight: 700, color: '#111827' }}>
              {parseInt(players).toLocaleString()}
            </span>
            <span style={{ fontSize: '24px', fontWeight: 400, color: '#6b7280' }}>
              players
            </span>
          </div>
        </div>

        {/* Tagline footer */}
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            display: 'flex',
            alignItems: 'baseline',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '38px', fontWeight: 700, color: '#459df8' }}>
            GUESS WORDS.
          </span>
          <span style={{ fontSize: '38px', fontWeight: 700, color: '#386ac3' }}>
            WIN CRYPTO.
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Soehne',
          data: soehneBold,
          weight: 700,
          style: 'normal',
        },
        {
          name: 'Soehne',
          data: soehneSemibold,
          weight: 600,
          style: 'normal',
        },
        {
          name: 'Soehne',
          data: soehneBook,
          weight: 400,
          style: 'normal',
        },
      ],
    }
  );

  // Convert Web Response → Node.js response
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  res.end(buffer);
}
