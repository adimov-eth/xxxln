import { BlockHash, PublicKey, SignatureData, EntityConfig, SignedTransaction, SignedStateUpdate } from './MachineTypes';
import { MachineId } from './Core';

// Base message types
export type MessageKind = 
  | 'STATE_UPDATE'
  | 'COMMAND'
  | 'EVENT'
  | 'QUERY'
  | 'RESPONSE';

// Server Messages
export type ServerCommand = 
  | { type: 'CREATE_SIGNER'; publicKey: PublicKey }
  | { type: 'PROCESS_BLOCK'; blockHash: BlockHash }
  | { type: 'SYNC_STATE'; targetHash: BlockHash };

// Signer Messages
export type SignerCommand =
  | { type: 'CREATE_ENTITY'; config: { threshold: number; signers: Array<[PublicKey, number]> } }
  | { type: 'SIGN_TRANSACTION'; txHash: string; signature: SignatureData };

// Entity Messages
export type EntityCommand =
  | { type: 'PROPOSE_TRANSACTION'; transaction: SignedTransaction }
  | { type: 'UPDATE_CONFIG'; newConfig: EntityConfig }
  | { type: 'OPEN_CHANNEL'; partnerId: MachineId }
  | { type: 'CLOSE_CHANNEL'; channelId: MachineId };

// Channel Messages
export type ChannelCommand =
  | { type: 'UPDATE_BALANCE'; balances: Array<[MachineId, bigint]> }
  | { type: 'INITIATE_DISPUTE'; evidence?: SignedStateUpdate }
  | { type: 'RESOLVE_DISPUTE'; evidence: SignedStateUpdate };

// Union type for all commands
export type Command = 
  | { kind: 'SERVER'; payload: ServerCommand }
  | { kind: 'SIGNER'; payload: SignerCommand }
  | { kind: 'ENTITY'; payload: EntityCommand }
  | { kind: 'CHANNEL'; payload: ChannelCommand };

// Event types
export type Event =
  | { type: 'BLOCK_PRODUCED'; blockHash: BlockHash }
  | { type: 'STATE_UPDATED'; machineId: MachineId; version: number }
  | { type: 'CHANNEL_OPENED'; channelId: MachineId }
  | { type: 'CHANNEL_CLOSED'; channelId: MachineId }
  | { type: 'DISPUTE_INITIATED'; channelId: MachineId }
  | { type: 'DISPUTE_RESOLVED'; channelId: MachineId };

// Query types
export type Query =
  | { type: 'GET_BALANCE'; entityId: MachineId }
  | { type: 'GET_CHANNEL_STATE'; channelId: MachineId }
  | { type: 'GET_BLOCK'; blockHash: BlockHash }
  | { type: 'GET_ENTITY_CONFIG'; entityId: MachineId };

// Response types
export type Response<T = unknown> = {
  readonly queryId: string;
  readonly data: T;
  readonly error?: string;
};

// Message validation types
export type ValidationResult = {
  readonly isValid: boolean;
  readonly error?: string;
};

// Message routing types
export type Route = {
  readonly source: MachineId;
  readonly target: MachineId;
  readonly path: MachineId[];
}; 