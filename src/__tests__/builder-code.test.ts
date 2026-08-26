/**
 * The Base Builder Code attribution suffix (ERC-8021).
 *
 * The suffix is written out as a raw hex literal in TWO places — the client
 * (`src/config/wagmi.ts`, appended by wagmi as `dataSuffix`) and the server
 * (`src/lib/builder-code.ts`, concatenated onto populated calldata by
 * `sendWithBuilderCode`). Nothing connects them, so a correction applied to one
 * and not the other would silently split attribution in half, with every
 * transaction still succeeding. That is the drift this file exists to catch.
 *
 * The layout is `[codes][codesLength(1)][schemaId(1)][marker(16)]`, which is
 * parsed BACKWARD from the end of calldata: read the last 16 bytes as the
 * marker, then one byte of schema, then one byte of length, then that many
 * bytes back for the code. The order matters and is not arbitrary — a layout
 * with the length first cannot be parsed from the tail, because you would have
 * to know where the code starts before you had read its length.
 */

import { describe, it, expect } from 'vitest';
import { ERC_8021_SUFFIX } from '../config/wagmi';
import { BUILDER_SUFFIX_HEX } from '../lib/builder-code';

const BUILDER_CODE = 'bc_lul4sldw';
const MARKER_BYTES = 16;

/** Parse the suffix the way a consumer reads it: backward from the tail. */
function parseSuffix(hex: string) {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  const marker = bytes.subarray(bytes.length - MARKER_BYTES);
  const schemaId = bytes[bytes.length - MARKER_BYTES - 1];
  const codesLength = bytes[bytes.length - MARKER_BYTES - 2];
  const codesEnd = bytes.length - MARKER_BYTES - 2;
  const codes = bytes.subarray(codesEnd - codesLength, codesEnd).toString('utf8');
  return { bytes, marker, schemaId, codesLength, codes };
}

describe('ERC-8021 builder code suffix', () => {
  it('decodes to bc_lul4sldw when read backward from the tail', () => {
    const { marker, schemaId, codesLength, codes } = parseSuffix(ERC_8021_SUFFIX);

    expect(marker.toString('hex')).toBe('80218021802180218021802180218021');
    expect(schemaId).toBe(0);
    expect(codes).toBe(BUILDER_CODE);
    // The declared length must match the real one, or a parser walks off the
    // front of the code and reads adjacent calldata as part of it.
    expect(codesLength).toBe(BUILDER_CODE.length);
  });

  it('has no trailing bytes the layout does not account for', () => {
    const { bytes, codesLength } = parseSuffix(ERC_8021_SUFFIX);
    expect(bytes.length).toBe(codesLength + 1 + 1 + MARKER_BYTES);
  });

  it('is byte-identical on the client and the server', () => {
    // wagmi wants the 0x prefix; the ethers concatenation must not have one.
    expect(ERC_8021_SUFFIX.startsWith('0x')).toBe(true);
    expect(BUILDER_SUFFIX_HEX.startsWith('0x')).toBe(false);
    expect(ERC_8021_SUFFIX.slice(2)).toBe(BUILDER_SUFFIX_HEX);
  });
});
