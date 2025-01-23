# Channel Implementation

## Overview
Payment channels enable off-chain transactions between parties while maintaining on-chain security guarantees. This document details the implementation of payment channels, including state management, updates, and dispute resolution.

## Core Types

### 1. Channel Definition
```typescript
interface Channel {
    id: string;
    participants: [Address, Address];
    token: Address;
    balances: {
        [participant: string]: bigint;
    };
    nonce: number;
    status: ChannelStatus;
    disputePeriod: number;
    lastUpdate: number;
    merkleRoot: string;
}

type ChannelStatus = 'OPENING' | 'ACTIVE' | 'DISPUTED' | 'CLOSING' | 'CLOSED';

interface ChannelUpdate {
    channelId: string;
    nonce: number;
    balances: {
        [participant: string]: bigint;
    };
    signatures: {
        [participant: string]: Signature;
    };
    timestamp: number;
}
```

### 2. State Types
```typescript
interface ChannelState {
    channelId: string;
    left: string;
    right: string;
    nonce: number;
    subchannels: {
        [key: string]: Subchannel;
    };
    signatures: Signature[];
    merkleRoot?: string;
    blockId?: number;
}

interface Subchannel {
    token: Address;
    balances: {
        [participant: string]: bigint;
    };
    status: ChannelStatus;
}
```

## Channel Management

### 1. Channel Creation
```typescript
class ChannelManager {
    async createChannel(params: {
        counterparty: Address;
        token: Address;
        initialDeposit: bigint;
    }): Promise<Channel> {
        // Create channel instance
        const channel: Channel = {
            id: generateId(),
            participants: [this.address, params.counterparty],
            token: params.token,
            balances: {
                [this.address]: params.initialDeposit,
                [params.counterparty]: 0n
            },
            nonce: 0,
            status: 'OPENING',
            disputePeriod: DEFAULT_DISPUTE_PERIOD,
            lastUpdate: Date.now(),
            merkleRoot: ''
        };

        // Lock collateral in Depository
        await this.depository.lockCollateral(
            channel.id,
            params.token,
            params.initialDeposit
        );

        await this.storage.saveChannel(channel);
        return channel;
    }
}
```

### 2. State Updates
```typescript
class ChannelStateManager {
    async updateState(
        channelId: string,
        newBalances: {
            [participant: string]: bigint;
        }
    ): Promise<ChannelUpdate> {
        const channel = await this.storage.getChannel(channelId);
        
        // Verify balances
        this.verifyBalances(channel, newBalances);
        
        const update: ChannelUpdate = {
            channelId,
            nonce: channel.nonce + 1,
            balances: newBalances,
            signatures: {},
            timestamp: Date.now()
        };
        
        // Sign update
        update.signatures[this.address] = this.sign(
            this.serializeUpdate(update)
        );
        
        return update;
    }
    
    async applyUpdate(update: ChannelUpdate): Promise<Channel> {
        const channel = await this.storage.getChannel(update.channelId);
        
        // Verify update
        this.verifyUpdate(channel, update);
        
        // Apply update
        const updatedChannel: Channel = {
            ...channel,
            balances: update.balances,
            nonce: update.nonce,
            lastUpdate: update.timestamp,
            merkleRoot: computeMerkleRoot(update)
        };
        
        await this.storage.saveChannel(updatedChannel);
        return updatedChannel;
    }
}
```

## Payment Processing

### 1. Payment Initiation
```typescript
class PaymentProcessor {
    async initiatePayment(params: {
        channelId: string;
        recipient: Address;
        amount: bigint;
    }): Promise<ChannelUpdate> {
        const channel = await this.storage.getChannel(params.channelId);
        
        // Calculate new balances
        const newBalances = {
            ...channel.balances,
            [this.address]: channel.balances[this.address] - params.amount,
            [params.recipient]: channel.balances[params.recipient] + params.amount
        };
        
        // Create and sign update
        return this.stateManager.updateState(
            params.channelId,
            newBalances
        );
    }
}
```

### 2. Payment Verification
```typescript
class PaymentVerifier {
    verifyPayment(
        channel: Channel,
        update: ChannelUpdate
    ): boolean {
        // Verify nonce
        if (update.nonce <= channel.nonce) return false;
        
        // Verify total balance remains same
        const oldTotal = Object.values(channel.balances)
            .reduce((a, b) => a + b, 0n);
        const newTotal = Object.values(update.balances)
            .reduce((a, b) => a + b, 0n);
        if (oldTotal !== newTotal) return false;
        
        // Verify signatures
        return this.verifySignatures(channel, update);
    }
}
```

## Dispute Resolution

### 1. Dispute Initiation
```typescript
class DisputeManager {
    async initiateDispute(
        channelId: string,
        evidence: ChannelUpdate
    ): Promise<void> {
        const channel = await this.storage.getChannel(channelId);
        
        // Submit dispute to Depository
        await this.depository.submitDispute(
            channelId,
            evidence,
            this.serializeEvidence(evidence)
        );
        
        // Update channel status
        await this.storage.saveChannel({
            ...channel,
            status: 'DISPUTED'
        });
    }
}
```

### 2. Dispute Resolution
```typescript
class DisputeResolver {
    async resolveDispute(
        channelId: string,
        finalState: ChannelUpdate
    ): Promise<void> {
        const channel = await this.storage.getChannel(channelId);
        
        // Verify final state
        if (!this.verifyFinalState(channel, finalState)) {
            throw new Error('Invalid final state');
        }
        
        // Submit resolution to Depository
        await this.depository.resolveDispute(
            channelId,
            finalState,
            this.serializeFinalState(finalState)
        );
        
        // Update channel status
        await this.storage.saveChannel({
            ...channel,
            status: 'CLOSED',
            balances: finalState.balances
        });
    }
}
```

## Security Implementation

### 1. State Verification
```typescript
class StateVerifier {
    verifyState(
        channel: Channel,
        state: ChannelState
    ): boolean {
        // Verify merkle root
        if (!this.verifyMerkleRoot(state)) return false;
        
        // Verify signatures
        if (!this.verifyStateSignatures(state)) return false;
        
        // Verify balances
        return this.verifyBalances(channel, state);
    }
}
```

### 2. Signature Management
```typescript
class SignatureManager {
    async collectSignatures(
        update: ChannelUpdate,
        participants: Address[]
    ): Promise<Signature[]> {
        const signatures: Signature[] = [];
        
        for (const participant of participants) {
            const signature = await this.requestSignature(
                participant,
                this.serializeUpdate(update)
            );
            
            if (!this.verifySignature(
                participant,
                signature,
                update
            )) {
                throw new Error('Invalid signature');
            }
            
            signatures.push(signature);
        }
        
        return signatures;
    }
}
```

## Best Practices

### 1. State Management
- Always verify state transitions
- Maintain complete state history
- Use atomic updates
- Handle race conditions

### 2. Security
- Validate all signatures
- Verify balance conservation
- Implement proper timeouts
- Handle edge cases

### 3. Dispute Handling
- Keep sufficient evidence
- Implement proper timeouts
- Handle malicious behavior
- Maintain audit trails

### 4. Performance
- Batch updates when possible
- Optimize signature verification
- Cache channel states
- Use efficient data structures
``` 