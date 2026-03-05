/**
 * ERC-8021 Builder Code Utilities (Backend)
 *
 * Appends the Base Builder Code attribution suffix to ethers.js transactions.
 * This is the backend equivalent of the `dataSuffix` option in wagmi's writeContract.
 *
 * Builder code: bc_lul4sldw
 * See https://docs.base.org/base-chain/quickstart/builder-codes
 */

import { ethers, type ContractTransactionResponse } from 'ethers';

/**
 * Raw hex bytes (no 0x prefix) of the ERC-8021 builder code suffix.
 * Matches the client-side ERC_8021_SUFFIX in src/config/wagmi.ts.
 */
const BUILDER_SUFFIX_HEX = '62635f6c756c34736c64770b0080218021802180218021802180218021';

/**
 * Send a contract method call with the ERC-8021 builder code appended.
 *
 * Works by populating the transaction, appending the suffix to calldata,
 * then sending via the contract's signer.
 *
 * @param contract - ethers.Contract instance (must have a signer attached)
 * @param functionName - The contract function to call
 * @param args - Array of arguments for the function
 * @param overrides - Optional transaction overrides (value, gasLimit, etc.)
 * @returns The sent transaction response
 */
export async function sendWithBuilderCode(
  contract: ethers.Contract,
  functionName: string,
  args: unknown[],
  overrides?: ethers.Overrides & { value?: bigint }
): Promise<ContractTransactionResponse> {
  // Populate the transaction (encodes function data + applies overrides)
  const populated = await contract[functionName].populateTransaction(...args, overrides || {});

  // Append builder code suffix to calldata
  populated.data = populated.data + BUILDER_SUFFIX_HEX;

  // Send via the contract's signer
  const signer = contract.runner as ethers.Wallet;
  const tx = await signer.sendTransaction(populated);
  return tx as ContractTransactionResponse;
}
