# Network Protocols

## Communication Protocols

### 1. Message Exchange Protocol

#### Transaction Messages
```typescript
interface Transaction {
    id: string;
    nonce: number;
    sender: Address;
    command: string;
    data: any;
    signature: Signature;
    timestamp: number;
}
```

**Flow:**
1. Sender creates signed transaction
2. Transaction enters TX In queue
3. Receiver validates signature and nonce
4. Transaction processed or rejected
5. Response sent through TX Out queue

#### Event Messages
```typescript
interface Event {
    id: string;
    type: string;
    data: any;
    source: Address;
    timestamp: number;
}
```

**Flow:**
1. Parent machine generates event
2. Event enters child's Event In queue
3. Child processes event immediately
4. State updated if necessary
5. Child may generate new events

### 2. Consensus Protocol

#### Block Production
- 100ms cycle for block creation
- Collect pending transactions
- Create Merkle tree of state
- Gather required signatures
- Distribute finalized block

#### State Finalization
1. **Proposal Phase**
   - Proposer creates block
   - Includes pending transactions
   - Computes new state root
   - Signs block header

2. **Validation Phase**
   - Validators check block
   - Verify transactions
   - Validate state transition
   - Sign if valid

3. **Finalization Phase**
   - Collect threshold signatures
   - Update state root
   - Propagate to children
   - Clear processed transactions

### 3. Channel Protocol

#### Channel Establishment
1. **Initiation**
   - Parties agree on terms
   - Lock collateral
   - Create channel machine
   - Exchange initial states

2. **Operation**
   - Off-chain state updates
   - Bilateral signatures
   - Merkle proof generation
   - Balance tracking

3. **Settlement**
   - Final state agreement
   - Submit closing transaction
   - Release collateral
   - Handle disputes if any

#### Payment Flow
1. **Payment Initiation**
   - Sender creates update
   - Signs new state
   - Sends to counterparty

2. **Payment Processing**
   - Receiver validates state
   - Checks balances
   - Signs if valid
   - Returns signature

3. **State Update**
   - Both parties update state
   - Generate Merkle proof
   - Store signed state
   - Clear previous state

### 4. Dispute Resolution Protocol

#### Dispute Types
1. **State Disputes**
   - Conflicting state claims
   - Missing signatures
   - Invalid state transitions

2. **Balance Disputes**
   - Insufficient funds
   - Double spends
   - Invalid transfers

3. **Protocol Disputes**
   - Timeout violations
   - Invalid messages
   - Missing responses

#### Resolution Process
1. **Dispute Initiation**
   - Submit dispute claim
   - Provide evidence
   - Start challenge period

2. **Challenge Period**
   - Counter-evidence submission
   - Signature verification
   - State validation

3. **Resolution**
   - Determine valid state
   - Apply penalties
   - Update balances
   - Close channel if necessary

### 5. Governance Protocol

#### Proposal Lifecycle
```typescript
interface Proposal {
    id: string;
    nonce: number;
    creator: Address;
    transaction: Transaction;
    baseState: {
        stateRoot: Hash;
        blockHeight: number;
    };
    votes: Record<Address, Vote>;
    threshold: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
    expiresAt: number;
    timestamp: number;
}
```

1. **Creation**
   - Submit proposal
   - Set voting period
   - Define threshold
   - Initialize vote tracking

2. **Voting**
   - Collect votes
   - Verify voter rights
   - Track vote weights
   - Update status

3. **Execution**
   - Check threshold
   - Execute if approved
   - Update state
   - Clean up proposal

### 6. State Sync Protocol

#### Full Sync
1. **Initial Request**
   - Request state root
   - Get block headers
   - Verify chain
   - Request state chunks

2. **State Transfer**
   - Receive state parts
   - Verify Merkle proofs
   - Reconstruct state
   - Validate final root

#### Incremental Sync
1. **Update Detection**
   - Monitor new blocks
   - Check state changes
   - Request updates
   - Verify proofs

2. **State Update**
   - Apply changes
   - Update local state
   - Verify consistency
   - Confirm sync 