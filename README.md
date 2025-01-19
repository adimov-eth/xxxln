# Extended Payment Network

## Overview
A scalable, decentralized payment network built on an actor-based architecture with hierarchical state management. The system combines off-chain payment channels with multi-signature capabilities and event-driven communication to enable efficient, secure transactions.

## Key Features
- 🏗️ Hierarchical State-Time Machine (HSTM) architecture
- 🔐 Multi-signature entity support
- 📨 Actor-based message passing
- ⚡ Off-chain payment channels
- 🔄 Event-driven state management
- 🌐 Distributed consensus mechanism

## Architecture

### Core Components

#### 1. Actor Types
- **Signer Machine (Root)**: Base level machine for individual signers
- **Entity Machine**: Multi-signature or DAO-like structures
- **Channel Machine**: Payment channels between parties
- **Depository Machine**: Manages reserve assets and collateral

#### 2. Communication Channels
Each entity maintains four communication channels:
- Transaction Inbox (TX In)
- Transaction Outbox (TX Out)
- Event Inbox
- Event Outbox


### Basic Usage

#### 1. Create a Signer Entity
```typescript
import { SignerMachine } from '@payment-network/node';

const signer = await SignerMachine.create({
  privateKey: '0x...',
  network: 'testnet'
});
```

#### 2. Create a Multi-Signature Entity
```typescript
const multiSig = await signer.createEntity({
  signers: ['0xAddress1', '0xAddress2'],
  threshold: 2
});
```

#### 3. Open a Payment Channel
```typescript
const channel = await multiSig.openChannel({
  counterparty: '0xCounterpartyAddress',
  deposit: '1.0',
  token: 'ETH'
});
```

## Core Concepts

### Multi-Signature Entities
Multi-signature entities (e.g., A-B) are created by combining two or more entities. They require multiple signatures for transactions based on a predefined threshold.

```typescript
interface IMultiSigEntity {
  signers: string[];
  threshold: number;
  proposeTransaction(tx: Transaction): Promise<void>;
  collectSignatures(txId: string): Promise<string[]>;
}
```

### State Management
The system uses a Hierarchical State-Time Machine (HSTM) for managing state:

```typescript
interface IMachineState {
  blockTime: number;
  board: {
    threshold: number;
    signers: Array<{
      address: string;
      weight: number;
    }>;
  };
  reserves: Record<string, bigint>;
  nonces: Record<string, number>;
  proposals: Proposal[];
  children: string[];
}
```

### Message Flow
1. Transactions flow upward through entity hierarchy
2. Events flow downward from parent to child entities
3. All messages are processed through respective inboxes/outboxes

## Advanced Features

### Payment Channels
- Off-chain state updates
- Dispute resolution mechanism
- Hash Time Locked Contracts (HTLCs) for atomic swaps

### Consensus Mechanism
- Multi-signature validation
- Proposal-based governance
- Threshold signature schemes

### Security Features
- Cryptographic message signing
- Secure state transitions
- Dispute resolution protocol
- Byzantine fault tolerance