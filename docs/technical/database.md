# Database Architecture

## Overview
The system implements a robust storage architecture using LevelDB, with three distinct database types optimized for different purposes: Mutable State, Immutable State, and Block History.

## Database Types

### 1. Mutable State Database
```typescript
interface MutableStateDB {
    // Key structure: 32B + 32B + 32B segments
    prefix: Buffer;  // 32 bytes
    identifier: Buffer;  // 32 bytes
    suffix: Buffer;  // 32 bytes
}

class MutableStateManager {
    private db: LevelDB;
    
    constructKey(
        prefix: Buffer,
        identifier: Buffer,
        suffix: Buffer
    ): Buffer {
        return Buffer.concat([prefix, identifier, suffix]);
    }
    
    async setState(
        key: Buffer,
        state: State
    ): Promise<void> {
        await this.db.put(key, state);
    }
    
    async getState(key: Buffer): Promise<State> {
        return this.db.get(key);
    }
}
```

#### Features
- Concatenated 32-byte segment key structure
- Optimized for frequent updates
- Stores current state information
- Supports rapid state transitions

### 2. Immutable State Database
```typescript
interface ImmutableStateDB {
    // Key is content hash of state
    stateHash: string;
    state: State;
    timestamp: number;
}

class ImmutableStateManager {
    private db: LevelDB;
    
    async saveState(state: State): Promise<string> {
        const stateHash = this.hashState(state);
        
        await this.db.put(stateHash, {
            state,
            timestamp: Date.now()
        });
        
        return stateHash;
    }
    
    private hashState(state: State): string {
        // Generate content-based hash
        return createHash('sha256')
            .update(JSON.stringify(state))
            .digest('hex');
    }
}
```

#### Features
- Content-based hash keys
- Optimized for state reconstruction
- Can run as separate service
- Provides audit capabilities

### 3. Block History Database
```typescript
interface BlockHistoryDB {
    // Sequential numeric keys
    blockNumber: number;  // e.g., 1, 2, 3
    block: Block;
    timestamp: number;
}

class BlockHistoryManager {
    private db: LevelDB;
    
    async saveBlock(
        blockNumber: number,
        block: Block
    ): Promise<void> {
        const key = this.formatBlockNumber(blockNumber);
        
        await this.db.put(key, {
            block,
            timestamp: Date.now()
        });
    }
    
    private formatBlockNumber(num: number): string {
        // Convert to 4-digit string (e.g., 0001)
        return num.toString().padStart(4, '0');
    }
}
```

#### Features
- Sequential numeric keys
- Simple, ordered structure
- Chronological block record
- Easy range queries

## Data Processing Flow

### 1. State Updates
```typescript
class StateProcessor {
    constructor(
        private mutableDB: MutableStateManager,
        private immutableDB: ImmutableStateManager,
        private blockDB: BlockHistoryManager
    ) {}
    
    async processStateUpdate(
        update: StateUpdate
    ): Promise<void> {
        // 1. Update mutable state
        await this.mutableDB.setState(
            update.key,
            update.newState
        );
        
        // 2. Store immutable record
        const stateHash = await this.immutableDB
            .saveState(update.newState);
        
        // 3. Create and store block
        const block = this.createBlock(
            update,
            stateHash
        );
        
        await this.blockDB.saveBlock(
            block.height,
            block
        );
    }
}
```

### 2. State Recovery
```typescript
class StateRecovery {
    async recoverState(
        targetHeight: number
    ): Promise<void> {
        // 1. Get block history
        const blocks = await this.blockDB
            .getRange(0, targetHeight);
        
        // 2. Verify against immutable states
        for (const block of blocks) {
            const immutableState = 
                await this.immutableDB.getState(
                    block.stateHash
                );
            
            if (!this.verifyState(
                block.state,
                immutableState
            )) {
                throw new Error('State mismatch');
            }
        }
        
        // 3. Rebuild mutable state
        await this.rebuildMutableState(blocks);
    }
}
```

## Best Practices

### 1. Mutable State Management
- Use atomic operations for updates
- Implement proper locking mechanisms
- Regular state validation
- Efficient key structure usage

### 2. Immutable State Handling
- Content-based addressing
- Efficient storage allocation
- Regular integrity checks
- Proper backup procedures

### 3. Block History Maintenance
- Sequential block validation
- Regular compaction
- Efficient range queries
- Proper indexing

### 4. Performance Optimization
- Batch operations where possible
- Implement proper caching
- Use efficient serialization
- Regular database maintenance

### 5. Data Integrity
- Cross-database validation
- Regular consistency checks
- Proper error handling
- Automated recovery procedures 