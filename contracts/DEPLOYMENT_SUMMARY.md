# Milestone 6.1 - Deployment Summary

## Deployment Status

| Network | Status | Proxy Address | Implementation |
|---------|--------|---------------|----------------|
| Base Sepolia | Pending (RPC issues) | - | - |
| Base Mainnet | **DEPLOYED** | `0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5` | `0x326C037B5FD53C9aDACd05122A8C7B4713D8760b` |

## Deployed Contract Addresses

### Base Mainnet (Chain ID: 8453)

| Contract | Address | BaseScan |
|----------|---------|----------|
| **Proxy (Use This)** | `0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5` | [View](https://basescan.org/address/0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5) |
| Implementation | `0x326C037B5FD53C9aDACd05122A8C7B4713D8760b` | [View](https://basescan.org/address/0x326C037B5FD53C9aDACd05122A8C7B4713D8760b) |

### Deployment Transaction
- **Deployer**: `0x58a585909ccCd4f84EBc3868db6dA8d9882fEe9C`
- **Deployed**: 2025-11-25
- **Gas Used**: ~2.5M gas

## Deployer Wallet

- **Address**: `0x58a585909ccCd4f84EBc3868db6dA8d9882fEe9C`
- **Private Key**: Configured in `.env`

## Contract Configuration

### Wallet Addresses (Initialized in Contract)

| Role | Address | Description |
|------|---------|-------------|
| Owner | `0x58a585909ccCd4f84EBc3868db6dA8d9882fEe9C` | Can upgrade contract, change wallets |
| Prize Pool | `0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB` | letshaveaword.eth - Seeds jackpots |
| Operator | `0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38` | Authorized for resolving rounds |
| Creator Profit | `0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223` | Receives 20% of guess purchases |

## Contract Artifacts

### Compiled Files
- **Source**: `contracts/src/JackpotManager.sol`
- **ABI**: `contracts/artifacts/src/JackpotManager.sol/JackpotManager.json`
- **TypeChain Types**: `contracts/typechain-types/`

### Contract Details
- **Solidity Version**: 0.8.24
- **Optimizer**: Enabled (200 runs)
- **Pattern**: UUPS Upgradeable Proxy

## Test Results

```
  JackpotManager
    Initialization
      ✔ should set correct initial values
      ✔ should have correct constants
    Jackpot Seeding
      ✔ should allow operator to seed jackpot
      ✔ should not start round if seed below minimum
      ✔ should emit JackpotSeeded event
      ✔ should revert if non-operator tries to seed
    Starting Rounds
      ✔ should start round automatically when minimum seed is met
      ✔ should emit RoundStarted event
    Purchasing Guesses
      ✔ should allow guess purchases during active round
      ✔ should split payment 80/20 between jackpot and creator
      ✔ should emit GuessesPurchased event
      ✔ should revert if round not active
    Round Resolution
      ✔ should pay winner and end round
      ✔ should reset jackpot to zero after resolution
      ✔ should emit RoundResolved event
      ✔ should revert if non-operator tries to resolve
      ✔ should revert if winner address is zero
    Creator Profit Withdrawal
      ✔ should allow withdrawal of accumulated creator profit
      ✔ should emit CreatorProfitPaid event
      ✔ should revert if no profit to withdraw
    Admin Functions
      ✔ should allow owner to update operator wallet
      ✔ should allow owner to update creator profit wallet
      ✔ should allow owner to update prize pool wallet
      ✔ should revert if non-owner tries to update wallets
    Multiple Rounds
      ✔ should handle multiple rounds correctly
    Receive ETH
      ✔ should accept ETH from prize pool wallet and add to jackpot
      ✔ should accept ETH from operator wallet and add to jackpot

  27 passing
```

## Post-Deployment Steps

### 1. Update Environment Variables
Add to your `.env`:
```bash
JACKPOT_MANAGER_ADDRESS=0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5
```

### 2. Verify Contract on BaseScan
```bash
cd contracts
npx hardhat verify --network base 0x326C037B5FD53C9aDACd05122A8C7B4713D8760b
```

### 3. Seed Initial Jackpot
From the operator wallet (`0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38`):
- Call `seedJackpot()` with at least 0.03 ETH
- This will automatically start Round 1

## Contract Functions

### Operator Functions (onlyOperator)
- `seedJackpot()` - Seed jackpot with ETH
- `resolveRound(address winner)` - Resolve round and pay winner
- `startNextRound()` - Start new round after resolution
- `updateClanktonMarketCap(uint256)` - Oracle placeholder (M6.2)

### Player Functions
- `purchaseGuesses(address player, uint256 quantity)` - Buy guess packs

### View Functions
- `getCurrentRoundInfo()` - Get current round details
- `getRound(uint256)` - Get historical round
- `getPlayerGuessCount(address)` - Get player's guess count
- `isMinimumSeedMet()` - Check if seed requirement met
- `currentJackpot()` - Current jackpot amount
- `creatorProfitAccumulated()` - Pending creator profit

### Admin Functions (onlyOwner)
- `setOperatorWallet(address)` - Update operator
- `setCreatorProfitWallet(address)` - Update creator profit recipient
- `setPrizePoolWallet(address)` - Update prize pool wallet

## Events

| Event | Parameters | Description |
|-------|------------|-------------|
| RoundStarted | roundNumber, startingJackpot, timestamp | New round begins |
| RoundResolved | roundNumber, winner, jackpotAmount, winnerPayout, timestamp | Round won |
| JackpotSeeded | roundNumber, seeder, amount, newJackpot | Jackpot funded |
| GuessesPurchased | roundNumber, player, quantity, ethAmount, toJackpot, toCreator | Guesses bought |
| CreatorProfitPaid | recipient, amount | Creator withdrew profit |

## Security Features

- **UUPS Upgradeable**: Owner can upgrade implementation
- **ReentrancyGuard**: Protected against reentrancy attacks
- **Custom Errors**: Gas-efficient error handling
- **Operator Pattern**: Restricted sensitive functions
- **Access Control**: Owner/Operator separation

## Gas Estimates

| Function | Estimated Gas |
|----------|---------------|
| Deploy (Proxy + Impl) | ~2,500,000 |
| seedJackpot | ~60,000 |
| purchaseGuesses | ~80,000 |
| resolveRound | ~100,000 |
| withdrawCreatorProfit | ~50,000 |

## Integration Notes

### Backend Integration
- Use `src/lib/jackpot-contract.ts` for contract interactions
- Use `src/lib/wallet-identity.ts` for unified wallet resolution
- Ensure winner address matches CLANKTON check wallet

### Environment Variables
```bash
# Contract address (DEPLOYED)
JACKPOT_MANAGER_ADDRESS=0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5

# Wallet configuration
PRIZE_POOL_WALLET=0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB
OPERATOR_WALLET=0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38
CREATOR_PROFIT_WALLET=0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223

# Optional: Operator private key for backend calls
OPERATOR_PRIVATE_KEY=<operator-wallet-private-key>
```

## Next Steps

1. ✅ **Deploy Contract**: Base Mainnet deployed
2. ⏳ **Verify Contract**: Run verification on BaseScan
3. ⏳ **Seed Jackpot**: Initial 0.03 ETH seed from operator wallet
4. ⏳ **Update Backend**: Set `JACKPOT_MANAGER_ADDRESS` in production
5. ⏳ **Base Sepolia**: Deploy testnet version when RPC issues resolved

## Milestone 6.2 Preview

Oracle integration for CLANKTON market cap:
- See `docs/MILESTONE_6_2_ORACLE_SPEC.md` for specification
- Contract already has `updateClanktonMarketCap()` placeholder
- Will enable automatic bonus tier adjustment

---

*Deployed: 2025-11-25*
*Milestone: 6.1 - Smart Contract Specification*
