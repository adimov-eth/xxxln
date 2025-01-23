# System Components

## Core Machine Types

### 1. Signer Machine (Root)
The base level machine for individual participants in the network.

**Key Features:**
- Manages private key for transaction signing
- Creates and manages child entities
- Handles entity-level consensus
- Routes messages between entities

**Responsibilities:**
- Transaction signing and validation
- Entity creation and management
- Message routing and processing
- State management for owned entities

### 2. Entity Machine
Represents programmable governance structures that can control channels and assets.

**Key Features:**
- Multi-signature capabilities
- DAO-like governance structures
- Proposal-based management
- Hierarchical permissions

**Types:**
- Single-user entities (simple private key)
- Multi-signature entities
- DAO-governed entities
- Federated groups

### 3. Channel Machine
Manages payment channels between entities for off-chain transactions.

**Key Features:**
- Off-chain state updates
- Bilateral account management
- Dispute resolution support
- Atomic swap capabilities

**Operations:**
- Channel opening/closing
- State updates
- Balance transfers
- Dispute handling

### 4. Depository Machine
Central vault managing on-chain assets and settlement.

**Key Features:**
- Reserve management
- Collateral handling
- Token support (ERC20, ERC721, ERC1155)
- Batch processing

**Responsibilities:**
- Asset custody
- Channel collateral
- Settlement processing
- Dispute resolution

## Communication System

### Message Types

1. **Transaction Inbox (TX In)**
- Purpose: Receives incoming signed transactions
- Contents: Method name, nonce, signatures
- Validation: Signature verification
- Processing: Sequential processing by nonce

2. **Transaction Outbox (TX Out)**
- Purpose: Sends transactions to other machines
- Requirements: All required signatures
- Validation: Complete signature set
- Delivery: Guaranteed by consensus

3. **Event Inbox**
- Purpose: Receives parent machine events
- Processing: Immediate processing
- Validation: Parent verification
- State: Updates local state

4. **Event Outbox**
- Purpose: Sends events to child machines
- Types: State updates, notifications
- Delivery: Hierarchical propagation
- Validation: Parent authorization

### Message Flow

1. **Upward Flow**
- Transactions flow up through hierarchy
- Each level adds necessary signatures
- Validation at each step
- Final processing at root

2. **Downward Flow**
- Events flow down from parent to child
- State updates propagate down
- Notifications to affected machines
- Guaranteed delivery

## State Management

### Machine State
```typescript
interface MachineState {
    blockTime: number;
    board: Board;
    reserves: Reserves;
    nonces: Nonces;
    proposals: Proposal[];
    children: string[];
}
```

### State Updates
1. **Block Creation**
   - 100ms cycle for updates
   - Aggregate pending transactions
   - Create Merkle tree
   - Collect signatures

2. **State Transition**
   - Validate incoming state
   - Apply transactions
   - Update Merkle root
   - Propagate changes

3. **Consensus**
   - Collect required signatures
   - Verify state transitions
   - Finalize blocks
   - Update child machines

## Storage Architecture

### LevelDB Structure
- Key format: `signer.id + machine.id`
- Value types: State, blocks, proofs
- Indexing: By block height and hash
- Caching: In-memory for active states

### State Persistence
1. **Block Storage**
   - Full block data
   - Transaction history
   - Event logs
   - Signatures

2. **State Storage**
   - Current state
   - Historical states
   - Merkle proofs
   - Consensus data

## Security Model

### Access Control
- Hierarchical permissions
- Signature requirements
- Proposal thresholds
- Time-based locks

### Cryptographic Security
- Multi-signature validation
- Merkle proof verification
- Hash-based integrity
- Temporal verification

### Dispute Resolution
- On-chain settlement
- Proof submission
- Time-locked resolution
- Penalty enforcement 