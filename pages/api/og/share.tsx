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
          backgroundColor: '#ffffff',
          fontFamily: 'Soehne',
        }}
      >
        {/* Round info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '12px',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              fontSize: '42px',
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
            gap: '10px',
            marginBottom: '32px',
          }}
        >
          <span
            style={{
              fontSize: '36px',
              fontWeight: 700,
              color: '#16a34a',
            }}
          >
            {parseFloat(jackpot).toFixed(4)} ETH
          </span>
          <span
            style={{
              fontSize: '28px',
              fontWeight: 400,
              color: '#6b7280',
            }}
          >
            prize pool
          </span>
        </div>

        {/* ELIMINATED label */}
        <div
          style={{
            fontSize: '22px',
            fontWeight: 600,
            color: '#ef4444',
            letterSpacing: '3px',
            marginBottom: '16px',
          }}
        >
          ELIMINATED
        </div>

        {/* Letter tiles */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '40px',
          }}
        >
          {letters.map((letter, i) => (
            <div
              key={i}
              style={{
                width: '100px',
                height: '100px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ffffff',
                border: '4px solid #2D68C7',
                borderRadius: '14px',
                boxShadow: '0 0 0 6px rgba(45, 104, 199, 0.25)',
                fontSize: '52px',
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
            gap: '24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#f3f4f6',
              borderRadius: '24px',
              padding: '10px 24px',
            }}
          >
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>
              {parseInt(guesses).toLocaleString()}
            </span>
            <span style={{ fontSize: '22px', fontWeight: 400, color: '#6b7280' }}>
              Guesses
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#f3f4f6',
              borderRadius: '24px',
              padding: '10px 24px',
            }}
          >
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>
              {parseInt(players).toLocaleString()}
            </span>
            <span style={{ fontSize: '22px', fontWeight: 400, color: '#6b7280' }}>
              Players
            </span>
          </div>
        </div>

        {/* Branding footer */}
        <div
          style={{
            position: 'absolute',
            bottom: '28px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '20px', fontWeight: 600, color: '#9ca3af' }}>
            letshaveaword.fun
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
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  res.end(buffer);
}
