import { Map } from 'immutable';
import { Machine, MachineId, State } from './Core';

// Common types for all machines
export type BlockHash = string;
export type SignatureData = string;
export type PublicKey = string;
export type PrivateKey = string;

// Transaction types
export type TransactionType = 
  | 'TRANSFER'
  | 'CHANNEL_UPDATE'
  | 'CONFIG_UPDATE'
  | 'STATE_UPDATE';

export type TransactionMetadata = {
  readonly chainId: string;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
};

export type Transaction = {
  readonly type: TransactionType;
  readonly nonce: number;
  readonly timestamp: number;
  readonly sender: MachineId;
  readonly payload: unknown;
  readonly metadata: TransactionMetadata;
};

export type SignedTransaction = Transaction & {
  readonly signatures: Map<PublicKey, SignatureData>;
  readonly recoveryParams: Map<PublicKey, number>; // For ECDSA signature recovery
};

// Server Machine Types
export type ServerStateData = {
  readonly blockHeight: number;
  readonly latestHash: BlockHash;
  readonly submachines: Map<MachineId, BlockHash>;
};

export type ServerState = Map<string, ServerStateData>;

export type ServerMachine = Machine & {
  readonly type: 'SERVER';
  readonly state: ServerState;
};

// Signer Machine Types
export type SignerStateData = {
  readonly publicKey: PublicKey;
  readonly entities: Map<MachineId, BlockHash>;
  readonly nonce: number;
  readonly pendingTransactions: Map<string, SignedTransaction>; // txHash -> SignedTransaction
};

export type SignerState = Map<string, SignerStateData>;

export type SignerMachine = Machine & {
  readonly type: 'SIGNER';
  readonly state: SignerState;
  readonly parentId: MachineId; // Server machine ID
};

// Entity Machine Types
export type EntityConfig = {
  readonly threshold: number;
  readonly signers: Map<PublicKey, number>; // signer -> weight
};

export type EntityState = State & Map<string, {
  readonly config: EntityConfig;
  readonly channels: Map<MachineId, BlockHash>;
  readonly balance: bigint;
  readonly nonce: number;
}>;

export type EntityMachine = Machine & {
  readonly type: 'ENTITY';
  readonly state: EntityState;
  readonly parentId: MachineId; // Signer machine ID
};

// Channel Machine Types
export type StateUpdate = {
  readonly sequence: number;
  readonly balances: Map<MachineId, bigint>;
  readonly timestamp: number;
};

export type SignedStateUpdate = StateUpdate & {
  readonly signatures: Map<PublicKey, SignatureData>;
  readonly stateHash: BlockHash;
};

export type DisputeState = {
  readonly initiator: MachineId;
  readonly contestedUpdate: SignedStateUpdate;
  readonly startTime: number;
  readonly resolved: boolean;
  readonly evidence?: SignedStateUpdate;
};

export type ChannelState = State & Map<string, {
  readonly participants: [MachineId, MachineId];
  readonly balances: Map<MachineId, bigint>;
  readonly sequence: number;
  readonly isOpen: boolean;
  readonly disputePeriod: number;
  readonly stateUpdates: Map<number, SignedStateUpdate>;
  readonly currentDispute?: DisputeState;
}>;

export type ChannelMachine = Machine & {
  readonly type: 'CHANNEL';
  readonly state: ChannelState;
  readonly parentIds: [MachineId, MachineId]; // Parent entity IDs
};

// Union type for all machine types
export type SpecificMachine = 
  | ServerMachine 
  | SignerMachine 
  | EntityMachine 
  | ChannelMachine;

// Type guard functions
export const isServerMachine = (machine: Machine): machine is ServerMachine => 
  (machine as ServerMachine).type === 'SERVER';

export const isSignerMachine = (machine: Machine): machine is SignerMachine =>
  (machine as SignerMachine).type === 'SIGNER';

export const isEntityMachine = (machine: Machine): machine is EntityMachine =>
  (machine as EntityMachine).type === 'ENTITY';

export const isChannelMachine = (machine: Machine): machine is ChannelMachine =>
  (machine as ChannelMachine).type === 'CHANNEL'; 