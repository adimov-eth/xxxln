import { Map } from 'immutable';
import { Message, MachineId, Hash } from './Core';
import { ServerCommand } from './Messages';

// Block header contains metadata about the block
export interface BlockHeader {
    readonly height: number;
    readonly timestamp: number;
    readonly prevHash: Hash;
    readonly stateRoot: Hash;
    readonly transactionsRoot: Hash;
    readonly proposer: MachineId;
}

// Block represents a full block in the chain
export interface Block {
    readonly header: BlockHeader;
    readonly transactions: ReadonlyArray<Message<ServerCommand>>;
    readonly signatures: Map<string, string>;
}

// Mempool entry with additional metadata
export interface MempoolEntry {
    readonly transaction: Message<ServerCommand>;
    readonly receivedAt: number;
    readonly gasPrice: bigint;
    readonly nonce: number;
}

// Mempool state
export interface MempoolState {
    readonly pending: Map<string, MempoolEntry>; // txHash -> MempoolEntry
    readonly processing: Map<string, MempoolEntry>; // txHash -> MempoolEntry
    readonly maxSize: number;
    readonly currentSize: number;
}

// Block production configuration
export interface BlockProductionConfig {
    readonly maxTransactionsPerBlock: number;
    readonly blockTime: number; // Target time between blocks in ms
    readonly maxBlockSize: number; // in bytes
    readonly minGasPrice: bigint;
}

// Block validation result
export interface BlockValidationResult {
    readonly isValid: boolean;
    readonly error?: string;
    readonly missingTransactions?: ReadonlyArray<string>; // hashes of missing transactions
    readonly invalidTransactions?: ReadonlyArray<string>; // hashes of invalid transactions
}

// Block store interface
export interface BlockStore {
    readonly getBlock: (hash: Hash) => Promise<Block | undefined>;
    readonly getBlockByNumber: (number: number) => Promise<Block | undefined>;
    readonly putBlock: (block: Block) => Promise<void>;
    readonly hasBlock: (hash: Hash) => Promise<boolean>;
    readonly getLatestBlock: () => Promise<Block | undefined>;
    readonly getBlockRange: (fromNumber: number, toNumber: number) => Promise<ReadonlyArray<Block>>;
}

// Helper functions
export const createMempoolState = (maxSize: number = 10000): MempoolState => ({
    pending: Map(),
    processing: Map(),
    maxSize,
    currentSize: 0
});

export const createBlockProductionConfig = (): BlockProductionConfig => ({
    maxTransactionsPerBlock: 100,
    blockTime: 1000, // 1 second
    maxBlockSize: 1024 * 1024, // 1MB
    minGasPrice: BigInt(1)
});

export type PublicKey = string;
export type SignatureData = string; 