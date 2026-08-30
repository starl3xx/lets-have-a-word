/**
 * Inert stand-in for @solana/web3.js.
 *
 * This game runs on Base and imports nothing from Solana — but
 * @farcaster/miniapp-sdk star-re-exports @farcaster/miniapp-core, whose CJS
 * build re-exports its Solana module with no sideEffects flag, so
 * tree-shaking cannot drop it and every player downloaded ~60 KB gz of
 * @solana/web3.js on first load. next.config.ts aliases the package here
 * instead (turbopack.resolveAlias).
 *
 * miniapp-core references these members (dist/solana.js, dist/solanaWire.js):
 * the Connection class, Transaction.from, VersionedTransaction.deserialize,
 * and VersionedMessage.deserializeMessageVersion. They exist here so
 * property access resolves; using them throws with a clear message instead
 * of failing somewhere strange. Keypair exists for @coinbase/cdp-sdk (a
 * transitive dependency of @base-org/account whose Solana utils are
 * currently tree-shaken out entirely).
 *
 * RE-CHECK THIS ALIAS ON EVERY @farcaster/miniapp-sdk AND @base-org/*
 * UPGRADE: if a future version (or a Farcaster host driving Solana wallet
 * actions through the SDK) needs the real library, this stub turns that
 * path into the throw below. The alias is global to client AND server
 * graphs. Today no app code touches Solana and the game pays on Base only.
 */

const NOT_SUPPORTED =
  'Solana is not supported in Let’s Have A Word (stubbed out of the bundle; see src/lib/solana-stub.ts)';

function unsupported(): never {
  throw new Error(NOT_SUPPORTED);
}

export class Connection {
  constructor(..._args: unknown[]) {
    unsupported();
  }
}

export class Transaction {
  constructor(..._args: unknown[]) {
    unsupported();
  }

  static from(..._args: unknown[]): never {
    unsupported();
  }
}

export class VersionedMessage {
  constructor(..._args: unknown[]) {
    unsupported();
  }

  static deserialize(..._args: unknown[]): never {
    unsupported();
  }

  // The FIRST web3.js member miniapp-core touches when a host drives
  // signTransaction (solanaWire.js unserializeTransaction). Without it the
  // failure would be a bare "not a function" instead of the clear throw.
  static deserializeMessageVersion(..._args: unknown[]): never {
    unsupported();
  }
}

export class VersionedTransaction {
  constructor(..._args: unknown[]) {
    unsupported();
  }

  static deserialize(..._args: unknown[]): never {
    unsupported();
  }
}

export class Keypair {
  constructor(..._args: unknown[]) {
    unsupported();
  }

  static generate(..._args: unknown[]): never {
    unsupported();
  }

  static fromSecretKey(..._args: unknown[]): never {
    unsupported();
  }
}

export default {
  Connection,
  Transaction,
  VersionedMessage,
  VersionedTransaction,
  Keypair,
};
