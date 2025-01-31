import { Map } from 'immutable';
import { MachineId, Hash, Block } from './Core';

export type SyncStatus = 
    | 'IDLE'
    | 'SYNCING'
    | 'SYNCED'
    | 'ERROR';

export interface SyncState {
    readonly status: SyncStatus;
    readonly currentHeight: number;
    readonly targetHeight: number;
    readonly lastSyncedBlock: Hash;
    readonly missingBlocks: Set<Hash>;
    readonly pendingBlocks: Map<Hash, Block>;
    readonly error?: string;
}

export interface SyncRequest {
    readonly type: 'SNAPSHOT' | 'BLOCKS' | 'STATE';
    readonly fromHeight?: number;
    readonly toHeight?: number;
    readonly blockHashes?: ReadonlyArray<Hash>;
    readonly stateRoot?: Hash;
}

export interface SyncResponse {
    readonly type: 'SNAPSHOT' | 'BLOCKS' | 'STATE';
    readonly blocks?: ReadonlyArray<Block>;
    readonly stateData?: Map<string, unknown>;
    readonly stateRoot?: Hash;
    readonly error?: string;
}

export interface SyncConfig {
    readonly maxBatchSize: number;
    readonly syncInterval: number;
    readonly retryAttempts: number;
    readonly timeout: number;
    readonly snapshotInterval: number;
}

export interface SyncMetrics {
    readonly lastSyncAttempt: number;
    readonly lastSuccessfulSync: number;
    readonly totalBlocksSynced: number;
    readonly failedAttempts: number;
    readonly averageSyncTime: number;
}

export interface SyncSnapshot {
    readonly height: number;
    readonly stateRoot: Hash;
    readonly timestamp: number;
    readonly data: Map<string, unknown>;
    readonly machineStates: Map<MachineId, {
        readonly stateRoot: Hash;
        readonly data: Map<string, unknown>;
    }>;
} 