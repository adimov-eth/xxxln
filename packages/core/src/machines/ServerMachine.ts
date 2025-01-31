import { Either, left, right, chain, map } from 'fp-ts/Either';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';
import { createHash } from 'crypto';

import { MachineError, Message, createMachineError } from '../types/Core';
import { ServerCommand, Event } from '../types/Messages';
import { BlockHash } from '../types/MachineTypes';
import { EventBus } from '../eventbus/EventBus';
import { AbstractBaseMachine, BaseMachineState } from './BaseMachine';
import { MempoolEntry } from '../types/BlockTypes';

// Extended base state for server
interface ExtendedBaseMachineState extends BaseMachineState {
    readonly submachines: Map<string, BlockHash>;
    readonly lastBlockTime: number;
    readonly lastSyncTime: number;
}

// Server-specific state
export interface ServerStateData extends ExtendedBaseMachineState {}

// Create initial server state
export const createServerState = (
    blockHeight: number = 0,
    latestHash: BlockHash = '',
    submachines: Map<string, BlockHash> = Map()
): ServerStateData => {
    const state: ServerStateData = {
        blockHeight,
        latestHash,
        stateRoot: '',
        data: Map(),
        nonces: Map(),
        parentId: null,
        childIds: [],
        submachines,
        lastBlockTime: Date.now(),
        lastSyncTime: Date.now()
    };
    return state;
};

// Server machine implementation
export class ServerMachineImpl extends AbstractBaseMachine {
    constructor(
        id: string,
        eventBus: EventBus,
        initialState: ServerStateData = createServerState()
    ) {
        super(id, 'SERVER', eventBus, initialState);
        this.startBlockProduction();
        this.startStateSync();
    }

    private _blockProductionInterval?: NodeJS.Timeout;
    private _syncInterval?: NodeJS.Timeout;

    // Start block production loop
    private startBlockProduction(): void {
        this._blockProductionInterval = setInterval(async () => {
            await this.produceBlock();
        }, 100); // 100ms block time
    }

    // Stop block production
    public stopBlockProduction(): void {
        if (this._blockProductionInterval) {
            clearInterval(this._blockProductionInterval);
            this._blockProductionInterval = undefined;
        }
    }

    // Start state synchronization loop
    private startStateSync(): void {
        const SYNC_INTERVAL = 5000; // 5 seconds
        
        this._syncInterval = setInterval(() => {
            void this.syncChildStates();
        }, SYNC_INTERVAL);
    }

    // Stop state synchronization
    public stopStateSync(): void {
        if (this._syncInterval) {
            clearInterval(this._syncInterval);
            this._syncInterval = undefined;
        }
    }

    // Implement abstract methods
    async handleEvent(event: Message<ServerCommand>): Promise<Either<MachineError, void>> {
        try {
            // Handle state sync commands
            if (event.payload.type === 'UPDATE_CHILD_STATE') {
                const data = this._state as ServerStateData;
                const newState: ServerStateData = {
                    ...data,
                    submachines: data.submachines.set(event.payload.childId, event.payload.stateRoot)
                };
                this._state = newState;
                this._version++;
                return right(undefined);
            }

            if (event.payload.type === 'SYNC_CHILD_STATES') {
                void this.syncChildStates();
                return right(undefined);
            }

            // Add transaction to mempool
            if (event.payload.type !== 'PROCESS_BLOCK' && event.payload.type !== 'SYNC_STATE') {
                const entry: MempoolEntry = {
                    transaction: event,
                    receivedAt: Date.now(),
                    gasPrice: BigInt(1),
                    nonce: 0
                };
                this._mempool = {
                    ...this._mempool,
                    pending: this._mempool.pending.set(event.id, entry),
                    currentSize: this._mempool.currentSize + 1
                };
                return right(undefined);
            }

            // Process non-transaction commands immediately
            const data = this._state as ServerStateData;
            switch (event.payload.type) {
                case 'PROCESS_BLOCK': {
                    const newState: ServerStateData = {
                        ...data,
                        blockHeight: data.blockHeight + 1,
                        latestHash: event.payload.blockHash
                    };
                    this._state = newState;
                    this._version++;

                    const outEvent: Message<ServerCommand> = {
                        id: `evt_${Date.now()}`,
                        type: 'BLOCK_PROCESSED',
                        payload: { type: 'REQUEST_BLOCK', blockHash: event.payload.blockHash },
                        sender: this.id,
                        recipient: event.sender,
                        timestamp: Date.now()
                    };
                    this.eventBus.dispatch(outEvent);
                    break;
                }

                case 'SYNC_STATE': {
                    const newState: ServerStateData = {
                        ...data,
                        latestHash: event.payload.targetHash
                    };
                    this._state = newState;
                    this._version++;

                    const outEvent: Message<ServerCommand> = {
                        id: `evt_${Date.now()}`,
                        type: 'STATE_SYNCED',
                        payload: { type: 'SYNC_STATE', targetHash: event.payload.targetHash },
                        sender: this.id,
                        recipient: event.sender,
                        timestamp: Date.now()
                    };
                    this.eventBus.dispatch(outEvent);
                    break;
                }
            }

            return right(undefined);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to handle event',
                error
            ));
        }
    }

    verifyStateTransition(from: ServerStateData, to: ServerStateData): Either<MachineError, boolean> {
        try {
            // Verify block height increases monotonically
            if (to.blockHeight < from.blockHeight) {
                return right(false);
            }

            // Verify submachine state roots
            for (const [machineId, stateRoot] of from.submachines) {
                const newRoot = to.submachines.get(machineId);
                if (!newRoot) {
                    return right(false);
                }
            }

            return right(true);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to verify state transition',
                error
            ));
        }
    }

    // Synchronize child states
    private async syncChildStates(): Promise<Either<MachineError, void>> {
        try {
            const data = this._state as ServerStateData;
            const now = Date.now();

            // For each submachine, request its current state root
            for (const [childId] of data.submachines) {
                const queryEvent: Message<ServerCommand> = {
                    id: `query_${Date.now()}`,
                    type: 'SYNC_STATE',
                    payload: { type: 'SYNC_STATE', targetHash: childId },
                    sender: this.id,
                    recipient: childId,
                    timestamp: now
                };
                this.eventBus.dispatch(queryEvent);
            }

            // Update last sync time
            const newState: ServerStateData = {
                ...data,
                lastSyncTime: now
            };
            this._state = newState;

            return right(undefined);
        } catch (error) {
            return left(createMachineError(
                'INTERNAL_ERROR',
                'Failed to sync child states',
                error
            ));
        }
    }
} 