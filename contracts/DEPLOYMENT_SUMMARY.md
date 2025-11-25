# Milestone 6.1 - Deployment Summary

## Deployment Status

| Network | Status | Address |
|---------|--------|---------|
| Base Sepolia | **Pending Funding** | - |
| Base Mainnet | **Pending Funding** | - |

## Deployer Wallet

- **Address**: `0x58a585909ccCd4f84EBc3868db6dA8d9882fEe9C`
- **Private Key**: Configured in `.env`

### Current Balances
- **Base Sepolia**: 0 ETH (needs testnet faucet)
- **Base Mainnet**: ~0.008 ETH (needs ~0.015 ETH more for deployment)

## Contract Configuration

### Wallet Addresses (Hardcoded in Contract)

| Role | Address | Description |
|------|---------|-------------|
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

## Deployment Steps

### Prerequisites
1. Fund the deployer wallet with ETH:
   - **Base Sepolia**: Get testnet ETH from [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)
   - **Base Mainnet**: Send ~0.02 ETH to `0x58a585909ccCd4f84EBc3868db6dA8d9882fEe9C`

2. Update RPC endpoints (optional - for better rate limits):
   - Get an Alchemy/QuickNode API key for Base
   - Update `BASE_RPC_URL` and `BASE_SEPOLIA_RPC_URL` in `.env`

### Deploy to Base Sepolia
```bash
cd contracts
npm run deploy:base-sepolia
```

### Deploy to Base Mainnet
```bash
cd contracts
npm run deploy:base
```

### Post-Deployment
1. Copy the proxy address to `.env`:
   ```
   JACKPOT_MANAGER_ADDRESS=<deployed-proxy-address>
   ```

2. Verify contract on BaseScan:
   ```bash
   npx hardhat verify --network base <implementation-address>
   ```

3. Seed initial jackpot (0.03 ETH minimum):
   - Call `seedJackpot()` from operator wallet with 0.03+ ETH

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
# Contract addresses (set after deployment)
JACKPOT_MANAGER_ADDRESS=<proxy-address>

# Wallet configuration
PRIZE_POOL_WALLET=0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB
OPERATOR_WALLET=0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38
CREATOR_PROFIT_WALLET=0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223

# Optional: Operator private key for backend calls
OPERATOR_PRIVATE_KEY=<operator-wallet-private-key>
```

## Next Steps

1. **Fund Deployer**: Send ETH to `0x58a585909ccCd4f84EBc3868db6dA8d9882fEe9C`
2. **Deploy Contracts**: Run deployment scripts
3. **Verify Contracts**: Verify on BaseScan for transparency
4. **Seed Jackpot**: Initial 0.03 ETH seed
5. **Update Backend**: Set `JACKPOT_MANAGER_ADDRESS` in production

## Milestone 6.2 Preview

Oracle integration for CLANKTON market cap:
- See `docs/MILESTONE_6_2_ORACLE_SPEC.md` for specification
- Contract already has `updateClanktonMarketCap()` placeholder
- Will enable automatic bonus tier adjustment

---

*Generated: 2025-11-25*
*Milestone: 6.1 - Smart Contract Specification*
