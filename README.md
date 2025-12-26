# SecureAPR

SecureAPR is a confidential ETH staking dApp powered by Zama FHEVM. It stores each user's stake as encrypted data on-chain, accrues fixed-rate interest in a confidential reward token (cCoin), and supports a proof-verified withdraw flow that reveals only what is necessary at the moment of exit.

This repository contains:
- Smart contracts for confidential staking and rewards.
- Hardhat deployment, tasks, and tests.
- A React + Vite frontend that reads with viem and writes with ethers, and integrates Zama relayer flows for decryption.

## Project Goals

- Keep user stake amounts confidential on-chain.
- Provide a simple, predictable interest model for ETH deposits.
- Allow users to claim interest at any time without exposing principal.
- Enable full withdrawal by decrypting the stake amount with a verifiable proof.
- Present balances and decryption actions in a clear frontend UX.

## Problems Solved

- **On-chain privacy for principal**: Traditional staking contracts store amounts in plaintext. SecureAPR keeps the staked amount encrypted (FHE), preventing public visibility of user deposits.
- **Privacy-preserving rewards**: Interest is minted into a confidential token (cCoin), so rewards are not publicly traceable.
- **Auditable withdrawal**: The contract verifies a decryption proof at withdrawal time, providing correctness guarantees without exposing historical stake data.
- **UX transparency**: Users can request decryption on-demand in the UI to view their cCoin balance and to finalize withdrawals.

## Key Features

- **Encrypted principal**: Stake amounts are stored as encrypted euint64 values.
- **Fixed APR-like accrual**: 10 cCoin units per micro-ETH per day, accrued linearly over time.
- **Claim anytime**: Interest can be claimed at any time; it is also accrued on stake/withdraw actions.
- **Withdraw-all flow**: Request withdrawal, obtain a decryption proof, finalize withdrawal with verification.
- **Confidential rewards token**: cCoin uses ERC7984 confidential balances.
- **No mock data**: All frontend data flows are from on-chain reads or verified decryptions.

## Advantages

- **Privacy-by-default**: Encrypted balances reduce on-chain data leakage.
- **Deterministic rewards**: Users can reason about yields without complex strategies.
- **Proof-verified exits**: Withdrawals require cryptographic proof, preventing forged redemptions.
- **Modular architecture**: Staking and reward token are separate contracts, easing audits and upgrades.
- **FHEVM-native design**: Leverages Zama primitives rather than custom cryptography.

## How It Works

1. **Stake ETH**
   - User sends ETH to `stake()` in multiples of 1e12 wei (micro-ETH).
   - The amount is converted to a `euint64` and stored encrypted.
   - The contract grants read permissions to itself and the user.

2. **Accrue Interest**
   - Interest accrues linearly over time based on last accrual timestamp.
   - Rate: 10 cCoin per micro-ETH per day.
   - Interest is minted to the user's confidential balance.

3. **Claim Interest**
   - User calls `claimInterest()` at any time.
   - The contract computes accrued interest since the last accrual and mints cCoin.

4. **Request Withdrawal**
   - User calls `requestWithdrawAll()`.
   - The encrypted stake amount is made publicly decryptable.
   - The UI triggers the Zama relayer flow to obtain the cleartext value and proof.

5. **Finalize Withdrawal**
   - User calls `finalizeWithdrawAll(encryptedStake, clearStake, proof)`.
   - The contract verifies the proof and transfers ETH to the user.
   - Stake state resets to zero.

6. **Decrypt cCoin Balance (UI)**
   - User can request decryption of their confidential balance.
   - The UI displays the decrypted value after proof verification.

## Smart Contracts

- `contracts/SecureAPRStaking.sol`
  - Accepts ETH stakes and stores them as encrypted micro-ETH values.
  - Accrues and mints cCoin interest using FHE arithmetic.
  - Implements withdraw request + proof-verified finalize flow.

- `contracts/ConfidentialCoin.sol`
  - Confidential ERC7984 token used for interest rewards.
  - Only the staking contract can mint.

- `contracts/FHECounter.sol`
  - Template example contract from the FHEVM scaffold (not part of core logic).

## Token and Accounting Model

- **Principal unit**: micro-ETH (1e12 wei).
- **Interest rate**: 10 cCoin units per micro-ETH per day.
- **Accrual**: linear, based on `block.timestamp` and the last accrual time.
- **Balance visibility**: cCoin balances are encrypted and can be decrypted on demand.

## Tech Stack

- **Contracts**: Solidity 0.8.x, FHEVM, OpenZeppelin Confidential Contracts, Hardhat
- **Zama**: `@fhevm/solidity` for encrypted arithmetic and proofs
- **Frontend**: React + Vite
- **Wallet/UI**: RainbowKit, wagmi
- **On-chain reads**: viem
- **On-chain writes**: ethers
- **Testing/Tasks**: Hardhat tests and custom tasks

## Repository Structure

```
SecureAPR/
├── contracts/           # Confidential staking and token contracts
├── deploy/              # Deployment scripts
├── tasks/               # Hardhat tasks (including UI sync)
├── test/                # Contract tests
├── docs/                # Zama integration notes
├── ui/                  # Frontend (React + Vite)
├── hardhat.config.ts    # Hardhat configuration
└── README.md            # Project documentation
```

## Setup and Development

### Prerequisites

- Node.js 20+
- npm
- A funded Sepolia account for deployment and testing

### Install

```bash
npm install
```

### Environment Variables (Contracts Only)

Create or update `.env` with the following (private key is required for Sepolia deployment):

```
INFURA_API_KEY=...
PRIVATE_KEY=...
ETHERSCAN_API_KEY=...    # optional
```

Notes:
- Use `PRIVATE_KEY` only. Mnemonics are not supported.
- Frontend does not rely on environment variables.

### Compile and Test

```bash
npm run compile
npm run test
```

### Deploy (Local Node)

```bash
npx hardhat node
npx hardhat deploy --network localhost
```

### Deploy (Sepolia)

```bash
npx hardhat deploy --network sepolia --tags SecureAPR
npx hardhat task:sync-ui --networkName sepolia
```

### Frontend (UI)

The UI lives in `ui/`. It connects to Sepolia and uses Zama relayer flows for decryption.

Typical flow in the UI:
1. Connect wallet.
2. Stake ETH in micro-ETH increments.
3. Claim interest or view updated cCoin balance.
4. Request withdraw and finalize after decryption proof.

## Security Considerations

- **Reentrancy protection**: Withdrawal uses `ReentrancyGuard`.
- **Proof verification**: Decryption proofs are verified on-chain before releasing funds.
- **Input validation**: Stake amounts must be non-zero and in micro-ETH units.
- **Encrypted storage**: Staked amounts and reward balances are not visible on-chain.

## Limitations

- Withdrawals are currently all-or-nothing (no partial withdraw).
- Interest rate is fixed and not governance-controlled.
- Requires FHEVM-compatible networks and the Zama relayer for decryption.
- Stake amounts must align to micro-ETH units (1e12 wei).

## Future Roadmap

- Partial withdrawals and configurable staking durations.
- Governance-controlled interest rate and reward parameters.
- Multi-asset staking (ERC20 deposits) with encrypted accounting.
- Enhanced UI analytics and privacy-preserving portfolio views.
- More extensive audits and formal verification for FHE flows.

## FAQ

**Why is the stake amount encrypted?**
To prevent public visibility of user deposits while still enabling on-chain accounting.

**How is interest calculated?**
Interest accrues linearly using the encrypted stake, elapsed time, and a fixed daily rate.

**Why is a decryption proof required to withdraw?**
The contract must know the clear stake amount to send ETH, and the proof ensures correctness.

**Can I see my cCoin balance?**
Yes. The UI can request decryption via the Zama relayer and display the clear value.

## License

BSD-3-Clause-Clear. See `LICENSE`.
