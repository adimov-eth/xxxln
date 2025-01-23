# Consensus Implementation

## Overview
The system implements a hybrid consensus mechanism combining aspects of PBFT (Practical Byzantine Fault Tolerance) for entity-level consensus and threshold signatures for channel state updates. This document details the implementation of both consensus mechanisms.

## Core Types

### 1. Consensus State
```typescript
interface ConsensusState {
    height: number;
    round: number;
    step: ConsensusStep;
    proposal?: Block;
    lockedValue?: Hash;
    lockedRound: number;
    validValue?: Hash;
    validRound: number;
    signatures: Map<Address, Signature>;
}

type ConsensusStep = 
    | 'PROPOSE'
    | 'PREVOTE'
    | 'PRECOMMIT'
    | 'COMMIT';

interface ConsensusMessage {
    type: ConsensusMessageType;
    height: number;
    round: number;
    value?: Hash;
    signature: Signature;
    sender: Address;
}

type ConsensusMessageType = 
    | 'PROPOSAL'
    | 'PREVOTE'
    | 'PRECOMMIT'
    | 'COMMIT';
```

## Consensus Implementation

### 1. Consensus Manager
```typescript
class ConsensusManager {
    private state: ConsensusState;
    private readonly validators: Set<Address>;
    private readonly threshold: number;
    
    async processMessage(
        message: ConsensusMessage
    ): Promise<void> {
        // Verify message signature
        if (!this.verifySignature(message)) {
            throw new Error('Invalid signature');
        }
        
        switch (message.type) {
            case 'PROPOSAL':
                await this.handleProposal(message);
                break;
            case 'PREVOTE':
                await this.handlePrevote(message);
                break;
            case 'PRECOMMIT':
                await this.handlePrecommit(message);
                break;
            case 'COMMIT':
                await this.handleCommit(message);
                break;
        }
    }
}
```

### 2. Proposal Phase
```typescript
class ConsensusManager {
    private async handleProposal(
        message: ConsensusMessage
    ): Promise<void> {
        if (message.height !== this.state.height ||
            message.round !== this.state.round) {
            return;
        }
        
        // Verify proposer is valid for this round
        if (!this.isValidProposer(
            message.sender,
            message.round
        )) {
            return;
        }
        
        // Validate proposal
        if (!await this.validateProposal(message.value)) {
            return;
        }
        
        // Update state
        this.state.proposal = message.value;
        
        // Broadcast prevote
        await this.broadcastPrevote(message.value);
    }
}
```

### 3. Voting Phases
```typescript
class ConsensusManager {
    private async handlePrevote(
        message: ConsensusMessage
    ): Promise<void> {
        // Add vote to state
        this.addVote(message);
        
        // Check if we have enough prevotes
        if (this.hasPrevoteQuorum()) {
            // Lock value
            this.state.lockedValue = message.value;
            this.state.lockedRound = this.state.round;
            
            // Broadcast precommit
            await this.broadcastPrecommit(message.value);
        }
    }
    
    private async handlePrecommit(
        message: ConsensusMessage
    ): Promise<void> {
        // Add vote to state
        this.addVote(message);
        
        // Check if we have enough precommits
        if (this.hasPrecommitQuorum()) {
            // Commit value
            await this.commit(message.value);
        }
    }
}
```

### 4. Commit Phase
```typescript
class ConsensusManager {
    private async commit(
        value: Hash
    ): Promise<void> {
        // Verify we have enough signatures
        if (!this.hasCommitQuorum()) {
            throw new Error('Invalid commit');
        }
        
        // Update state
        await this.applyCommit(value);
        
        // Move to next height
        this.advanceHeight();
    }
    
    private advanceHeight(): void {
        this.state = {
            height: this.state.height + 1,
            round: 0,
            step: 'PROPOSE',
            lockedRound: -1,
            validRound: -1,
            signatures: new Map()
        };
    }
}
```

## Threshold Signatures

### 1. Signature Collection
```typescript
class SignatureCollector {
    private readonly threshold: number;
    private readonly shares: Map<Address, Signature>;
    
    async collectSignatures(
        message: Hash,
        validators: Set<Address>
    ): Promise<Signature[]> {
        const signatures: Signature[] = [];
        
        for (const validator of validators) {
            const signature = await this.requestSignature(
                validator,
                message
            );
            
            if (this.verifySignature(
                validator,
                message,
                signature
            )) {
                signatures.push(signature);
            }
            
            if (signatures.length >= this.threshold) {
                break;
            }
        }
        
        return signatures;
    }
}
```

### 2. Signature Aggregation
```typescript
class SignatureAggregator {
    aggregateSignatures(
        signatures: Signature[]
    ): Signature {
        // Combine signature shares
        const combined = signatures.reduce(
            (acc, sig) => this.combineShares(acc, sig),
            ZERO_SIGNATURE
        );
        
        // Verify combined signature
        if (!this.verifyCombinedSignature(combined)) {
            throw new Error('Invalid combined signature');
        }
        
        return combined;
    }
}
```

## Timing and Synchronization

### 1. Round Management
```typescript
class RoundManager {
    private readonly timeoutPropose: number;
    private readonly timeoutPrevote: number;
    private readonly timeoutPrecommit: number;
    
    private scheduleTimeouts(): void {
        setTimeout(
            () => this.onProposeTimeout(),
            this.timeoutPropose
        );
        
        setTimeout(
            () => this.onPrevoteTimeout(),
            this.timeoutPrevote
        );
        
        setTimeout(
            () => this.onPrecommitTimeout(),
            this.timeoutPrecommit
        );
    }
    
    private async onTimeout(): Promise<void> {
        // Advance to next round
        this.state.round += 1;
        this.state.step = 'PROPOSE';
        
        // Clear votes for previous round
        this.state.signatures.clear();
        
        // Schedule new timeouts
        this.scheduleTimeouts();
    }
}
```

### 2. Height Synchronization
```typescript
class HeightSynchronizer {
    async synchronizeHeight(
        targetHeight: number
    ): Promise<void> {
        while (this.state.height < targetHeight) {
            // Request commit messages for height
            const commits = await this.requestCommits(
                this.state.height
            );
            
            // Verify and apply commits
            if (this.verifyCommits(commits)) {
                await this.applyCommits(commits);
                this.advanceHeight();
            }
        }
    }
}
```

## Best Practices

### 1. Message Handling
- Validate all messages
- Verify signatures
- Check message ordering
- Handle duplicate messages

### 2. State Management
- Maintain consistent state
- Handle state transitions atomically
- Implement proper error recovery
- Keep audit trails

### 3. Network Communication
- Handle network partitions
- Implement proper timeouts
- Use reliable message delivery
- Handle message reordering

### 4. Security
- Verify all signatures
- Validate state transitions
- Implement proper access control
- Handle Byzantine behavior
``` 