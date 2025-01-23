# Entity Implementation

## Overview
Entities are programmable governance structures that can represent individual users or complex organizations. This document details the implementation of the entity system, including multi-signature capabilities and proposal management.

## Core Types

### 1. Entity Definition
```typescript
interface Entity {
    id: string;
    tokenAddress: Address;    // Token representing membership/stakes
    name: string;            // Entity name
    currentBoardHash: Hash;  // Current active board hash
    proposedBoardHash: Hash; // Proposed board hash
    exists: boolean;
}

interface Board {
    threshold: number;       // Required voting threshold
    delegates: Delegate[];   // List of delegates with powers
}

interface Delegate {
    entityId: string;       // EOA (20 bytes) or entity ID
    votingPower: number;    // Delegate's voting weight
}
```

### 2. Proposal System
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
    status: ProposalStatus;
    expiresAt: number;
    timestamp: number;
}

type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

interface Vote {
    proposalId: string;
    voterAddress: Address;
    nonce: number;
    weight: number;
    signature: Signature;
    timestamp: number;
}
```

## Entity Management

### 1. Entity Creation
```typescript
class EntityManager {
    async createEntity(params: {
        name: string;
        tokenAddress: Address;
        board: Board;
    }): Promise<Entity> {
        const entity: Entity = {
            id: generateId(),
            name: params.name,
            tokenAddress: params.tokenAddress,
            currentBoardHash: computeBoardHash(params.board),
            proposedBoardHash: '',
            exists: true
        };

        await this.storage.saveEntity(entity);
        return entity;
    }
}
```

### 2. Board Management
```typescript
class BoardManager {
    async proposeBoard(
        entityId: string,
        newBoard: Board,
        signatures: Signature[]
    ): Promise<void> {
        const entity = await this.storage.getEntity(entityId);
        const currentBoard = await this.storage.getBoard(entity.currentBoardHash);
        
        // Verify signatures meet current threshold
        this.verifyBoardSignatures(currentBoard, signatures);
        
        // Update entity with proposed board
        await this.storage.saveEntity({
            ...entity,
            proposedBoardHash: computeBoardHash(newBoard)
        });
        
        await this.storage.saveBoard(newBoard);
    }
    
    async activateBoard(
        entityId: string,
        signatures: Signature[]
    ): Promise<void> {
        const entity = await this.storage.getEntity(entityId);
        const proposedBoard = await this.storage.getBoard(entity.proposedBoardHash);
        
        // Verify signatures meet current threshold
        this.verifyBoardSignatures(proposedBoard, signatures);
        
        // Update entity with new active board
        await this.storage.saveEntity({
            ...entity,
            currentBoardHash: entity.proposedBoardHash,
            proposedBoardHash: ''
        });
    }
}
```

## Proposal Management

### 1. Proposal Creation
```typescript
class ProposalManager {
    async createProposal(params: {
        entityId: string;
        transaction: Transaction;
        creator: Address;
    }): Promise<Proposal> {
        const entity = await this.storage.getEntity(params.entityId);
        const board = await this.storage.getBoard(entity.currentBoardHash);
        
        const proposal: Proposal = {
            id: generateId(),
            nonce: await this.getNonce(params.creator),
            creator: params.creator,
            transaction: params.transaction,
            baseState: await this.getCurrentState(),
            votes: {},
            threshold: board.threshold,
            status: 'PENDING',
            expiresAt: Date.now() + PROPOSAL_DURATION,
            timestamp: Date.now()
        };
        
        await this.storage.saveProposal(proposal);
        return proposal;
    }
}
```

### 2. Vote Processing
```typescript
class VoteProcessor {
    async processVote(
        proposalId: string,
        vote: Vote
    ): Promise<Proposal> {
        const proposal = await this.storage.getProposal(proposalId);
        const board = await this.getCurrentBoard(proposal);
        
        // Verify voter rights
        this.verifyVoterRights(vote.voterAddress, board);
        
        // Add vote
        const updatedProposal = {
            ...proposal,
            votes: {
                ...proposal.votes,
                [vote.voterAddress]: vote
            }
        };
        
        // Check if threshold is met
        const totalWeight = this.calculateTotalWeight(updatedProposal.votes);
        if (totalWeight >= proposal.threshold) {
            await this.executeProposal(updatedProposal);
            updatedProposal.status = 'APPROVED';
        }
        
        await this.storage.saveProposal(updatedProposal);
        return updatedProposal;
    }
}
```

## Security Implementation

### 1. Signature Verification
```typescript
class SignatureVerifier {
    verifySignature(
        message: string,
        signature: Signature,
        address: Address
    ): boolean {
        return ecrecover(
            hashMessage(message),
            signature
        ) === address;
    }
    
    verifyBoardSignatures(
        board: Board,
        signatures: Signature[]
    ): boolean {
        let totalWeight = 0;
        
        for (const signature of signatures) {
            const signer = ecrecover(
                hashMessage(board.hash),
                signature
            );
            
            const delegate = board.delegates.find(
                d => d.entityId === signer
            );
            
            if (delegate) {
                totalWeight += delegate.votingPower;
            }
        }
        
        return totalWeight >= board.threshold;
    }
}
```

### 2. Access Control
```typescript
class AccessController {
    async checkAccess(
        entityId: string,
        action: string,
        caller: Address
    ): Promise<boolean> {
        const entity = await this.storage.getEntity(entityId);
        const board = await this.storage.getBoard(entity.currentBoardHash);
        
        const delegate = board.delegates.find(
            d => d.entityId === caller
        );
        
        if (!delegate) return false;
        
        return this.checkActionPermissions(
            action,
            delegate.votingPower,
            board.threshold
        );
    }
}
```

## Best Practices

### 1. Entity Management
- Validate all board changes
- Maintain clear upgrade paths
- Implement proper access controls
- Keep audit trails of changes

### 2. Proposal Handling
- Verify all signatures
- Check proposal expiration
- Maintain proposal history
- Handle concurrent votes properly

### 3. Security
- Use proper cryptographic primitives
- Implement rate limiting
- Validate all inputs
- Handle edge cases gracefully

### 4. Performance
- Batch operations when possible
- Cache frequently accessed data
- Optimize signature verification
- Use efficient data structures
``` 