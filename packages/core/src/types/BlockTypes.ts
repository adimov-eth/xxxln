import { Map as ImmutableMap } from 'immutable';
import { Message } from './Core';
import { BlockHash } from './MachineTypes';
import { ServerCommand } from './Messages';

// Block header contains metadata about the block
export type BlockHeader = Readonly<{
  blockNumber: number;
  parentHash: BlockHash;
  stateRoot: BlockHash;
  transactionsRoot: BlockHash;
  timestamp: number;
  proposer: string;
}>;

// Block data interface
export interface BlockData {
  header: BlockHeader;
  transactions: ReadonlyArray<Message<ServerCommand>>;
  signatures: ImmutableMap<PublicKey, SignatureData>;
}

// Block represents a full block in the chain
export interface Block {
  readonly header: BlockHeader;
  readonly transactions: ReadonlyArray<Message<ServerCommand>>;
  readonly signatures: ImmutableMap<string, string>;
}

// Mempool entry with additional metadata
export type MempoolEntry = Readonly<{
  transaction: Message<ServerCommand>;
  receivedAt: number;
  gasPrice: bigint;
  nonce: number;
}>;

// Mempool state
export type MempoolState = Readonly<{
  pending: ImmutableMap<string, MempoolEntry>; // txHash -> MempoolEntry
  processing: ImmutableMap<string, MempoolEntry>; // txHash -> MempoolEntry
  maxSize: number;
  currentSize: number;
}>;

// Block production configuration
export type BlockProductionConfig = Readonly<{
  maxTransactionsPerBlock: number;
  blockTime: number; // Target time between blocks in ms
  maxBlockSize: number; // in bytes
  minGasPrice: bigint;
}>;

// Block validation result
export type BlockValidationResult = Readonly<{
  isValid: boolean;
  error?: string;
  missingTransactions?: string[]; // hashes of missing transactions
  invalidTransactions?: string[]; // hashes of invalid transactions
}>;

// Block store interface
export type BlockStore = Readonly<{
  getBlock: (hash: BlockHash) => Promise<Block | undefined>;
  getBlockByNumber: (number: number) => Promise<Block | undefined>;
  putBlock: (block: Block) => Promise<void>;
  hasBlock: (hash: BlockHash) => Promise<boolean>;
  getLatestBlock: () => Promise<Block | undefined>;
  getBlockRange: (fromNumber: number, toNumber: number) => Promise<Block[]>;
}>;

// Helper functions for block operations
export const computeTransactionsRoot = (
  transactions: ReadonlyArray<Message<ServerCommand>>
): BlockHash => {
  // TODO: Implement Merkle tree root computation
  return '';
};

export const validateBlock = (
  block: Block,
  parentBlock?: Block
): BlockValidationResult => {
  // TODO: Implement block validation logic
  return { isValid: false };
};

export const createMempoolState = (maxSize: number = 10000): MempoolState => ({
  pending: ImmutableMap(),
  processing: ImmutableMap(),
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