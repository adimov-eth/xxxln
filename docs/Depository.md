The Depository is a smart contract that acts as the central vault and rule engine for the payment network, managing users' reserves, channel collateral, and dispute resolution. It's the ultimate source of truth for all on-chain assets and state transitions in the system.

### Core Purpose
The Depository acts as the primary "bank" of the system, managing:
1. User reserves (locked funds)
2. Payment channels
3. Collateral for channels
4. Dispute resolution

### Key Functions

1. **Reserve Management**
- Holds users' locked tokens/funds
- Allows transfers between reserves
- Tracks balances for different token types (ERC20, ERC721, ERC1155)

2. **Channel Operations**
```solidity
- Opening channels
- Managing channel collateral
- Processing cooperative updates
- Handling disputes
- Closing channels
```

3. **Balance Tracking**
```solidity
// Manages multiple balance types:
- Reserves: User's locked funds
- Collateral: Funds locked in channels
- Credit: Available credit lines
```

4. **Batch Processing**
Can process multiple operations in a single transaction:
```solidity
struct Batch {
    ReserveToExternalToken[] reserveToExternalToken;
    ExternalTokenToReserve[] externalTokenToReserve;
    ReserveToReserve[] reserveToReserve;
    ReserveToCollateral[] reserveToCollateral;
    CooperativeUpdate[] cooperativeUpdate;
    // ... more batch operations
}
```

Think of the Depository as a secure vault that:
- Holds all on-chain funds
- Enforces the rules of the payment network
- Ensures safe transitions between on-chain and off-chain states
- Provides final settlement when disputes arise

It's essentially the "source of truth" for the financial state of the entire system.