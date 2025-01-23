# Storage Implementation

## Overview
The system uses LevelDB as its primary storage engine, implementing a hierarchical key-value store with support for snapshots, batch operations, and efficient state reconstruction. This document details the storage implementation and best practices.

## Core Components

### 1. Storage Service
```typescript
interface StorageService {
    // Key-Value Operations
    get(key: string): Promise<any>;
    put(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    
    // Batch Operations
    batch(operations: BatchOperation[]): Promise<void>;
    
    // Range Operations
    getRange(
        start: string,
        end: string,
        limit?: number
    ): Promise<any[]>;
    
    // Snapshot Operations
    createSnapshot(): Promise<Snapshot>;
    restoreSnapshot(snapshot: Snapshot): Promise<void>;
}

interface BatchOperation {
    type: 'put' | 'delete';
    key: string;
    value?: any;
}

interface Snapshot {
    id: string;
    timestamp: number;
    data: Map<string, any>;
}
```

### 2. LevelDB Implementation
```typescript
class LevelStorageService implements StorageService {
    constructor(
        private db: Level,
        private prefix: string = ''
    ) {}
    
    private getFullKey(key: string): string {
        return `${this.prefix}:${key}`;
    }
    
    async get(key: string): Promise<any> {
        try {
            const data = await this.db.get(
                this.getFullKey(key)
            );
            return JSON.parse(data);
        } catch (err) {
            if (err.notFound) return null;
            throw err;
        }
    }
    
    async put(
        key: string,
        value: any
    ): Promise<void> {
        await this.db.put(
            this.getFullKey(key),
            JSON.stringify(value)
        );
    }
    
    async batch(
        operations: BatchOperation[]
    ): Promise<void> {
        const batch = this.db.batch();
        
        for (const op of operations) {
            const fullKey = this.getFullKey(op.key);
            
            if (op.type === 'put') {
                batch.put(
                    fullKey,
                    JSON.stringify(op.value)
                );
            } else {
                batch.del(fullKey);
            }
        }
        
        await batch.write();
    }
}
```

## State Storage

### 1. Machine State Storage
```typescript
class MachineStateStorage {
    constructor(
        private storage: StorageService,
        private machineId: string
    ) {}
    
    async saveState(state: State): Promise<void> {
        const key = `state:${this.machineId}`;
        await this.storage.put(key, state);
        
        // Save state root for quick lookup
        await this.storage.put(
            `root:${state.stateRoot}`,
            state
        );
    }
    
    async getStateByRoot(
        root: Hash
    ): Promise<State | null> {
        return this.storage.get(`root:${root}`);
    }
    
    async getLatestState(): Promise<State | null> {
        return this.storage.get(
            `state:${this.machineId}`
        );
    }
}
```

### 2. Block Storage
```typescript
class BlockStorage {
    constructor(private storage: StorageService) {}
    
    async saveBlock(block: Block): Promise<void> {
        const batch: BatchOperation[] = [
            // Store block by hash
            {
                type: 'put',
                key: `block:${block.stateRoot}`,
                value: block
            },
            // Store height index
            {
                type: 'put',
                key: `height:${block.height}`,
                value: block.stateRoot
            }
        ];
        
        await this.storage.batch(batch);
    }
    
    async getBlockByHash(
        hash: Hash
    ): Promise<Block | null> {
        return this.storage.get(`block:${hash}`);
    }
    
    async getBlockByHeight(
        height: number
    ): Promise<Block | null> {
        const hash = await this.storage.get(
            `height:${height}`
        );
        if (!hash) return null;
        return this.getBlockByHash(hash);
    }
}
```

## Snapshot Management

### 1. Snapshot Creation
```typescript
class SnapshotManager {
    async createSnapshot(
        machineId: string
    ): Promise<Snapshot> {
        const snapshot: Snapshot = {
            id: generateId(),
            timestamp: Date.now(),
            data: new Map()
        };
        
        // Get all machine state
        const state = await this.storage.getRange(
            `state:${machineId}:`,
            `state:${machineId}:\xFF`
        );
        
        // Store in snapshot
        for (const [key, value] of state) {
            snapshot.data.set(key, value);
        }
        
        // Save snapshot metadata
        await this.storage.put(
            `snapshot:${snapshot.id}`,
            snapshot
        );
        
        return snapshot;
    }
    
    async restoreSnapshot(
        snapshot: Snapshot
    ): Promise<void> {
        const batch: BatchOperation[] = [];
        
        for (const [key, value] of snapshot.data) {
            batch.push({
                type: 'put',
                key,
                value
            });
        }
        
        await this.storage.batch(batch);
    }
}
```

### 2. Incremental Snapshots
```typescript
class IncrementalSnapshotManager {
    async createIncremental(
        baseSnapshot: Snapshot,
        changes: Map<string, any>
    ): Promise<Snapshot> {
        const snapshot: Snapshot = {
            id: generateId(),
            timestamp: Date.now(),
            data: new Map(changes)
        };
        
        // Store base snapshot reference
        await this.storage.put(
            `snapshot:${snapshot.id}:base`,
            baseSnapshot.id
        );
        
        return snapshot;
    }
    
    async restore(
        snapshotId: string
    ): Promise<void> {
        const chain: Snapshot[] = [];
        let currentId = snapshotId;
        
        // Build chain of snapshots
        while (currentId) {
            const snapshot = await this.storage.get(
                `snapshot:${currentId}`
            );
            chain.push(snapshot);
            
            currentId = await this.storage.get(
                `snapshot:${currentId}:base`
            );
        }
        
        // Apply snapshots in reverse order
        for (const snapshot of chain.reverse()) {
            await this.restoreSnapshot(snapshot);
        }
    }
}
```

## Performance Optimization

### 1. Caching Layer
```typescript
class CachedStorageService implements StorageService {
    private cache: Map<string, any>;
    
    constructor(
        private storage: StorageService,
        private maxSize: number = 1000
    ) {
        this.cache = new Map();
    }
    
    async get(key: string): Promise<any> {
        // Check cache first
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        
        // Get from storage
        const value = await this.storage.get(key);
        
        // Update cache
        this.updateCache(key, value);
        
        return value;
    }
    
    private updateCache(
        key: string,
        value: any
    ): void {
        // Implement LRU or other eviction policy
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, value);
    }
}
```

### 2. Batch Processing
```typescript
class BatchProcessor {
    private batch: BatchOperation[] = [];
    private readonly maxBatchSize: number = 100;
    
    async addOperation(
        operation: BatchOperation
    ): Promise<void> {
        this.batch.push(operation);
        
        if (this.batch.length >= this.maxBatchSize) {
            await this.flush();
        }
    }
    
    async flush(): Promise<void> {
        if (this.batch.length === 0) return;
        
        await this.storage.batch(this.batch);
        this.batch = [];
    }
}
```

## Best Practices

### 1. Data Organization
- Use consistent key prefixes
- Implement proper indexing
- Maintain data locality
- Use efficient serialization

### 2. Performance
- Batch related operations
- Implement proper caching
- Use efficient queries
- Optimize data layout

### 3. Reliability
- Implement proper error handling
- Use atomic operations
- Maintain data consistency
- Create regular backups

### 4. Maintenance
- Implement compaction
- Monitor storage usage
- Clean up old data
- Verify data integrity
``` 