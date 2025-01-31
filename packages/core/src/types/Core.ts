import { Map } from 'immutable';
import { Command, Query, Response, Event as MessageEvent } from './Messages';

// Basic types
export type MachineId = string;
export type Hash = string;

// Base Machine interface
export interface Machine {
  readonly id: MachineId;
  readonly type: string;
  readonly state: Map<string, unknown>;
  readonly version: number;
}

// Error handling
export type ErrorCode = 
  | 'INTERNAL_ERROR'
  | 'INVALID_STATE'
  | 'INVALID_HASH'
  | 'INVALID_SIGNATURE'
  | 'INVALID_PROPOSAL'
  | 'UNAUTHORIZED'
  | 'INVALID_COMMAND'
  | 'INVALID_EVENT'
  | 'INVALID_MESSAGE'
  | 'INVALID_OPERATION'
  | 'VALIDATION_ERROR'
  | 'INVALID_CONFIG'
  | 'NETWORK_ERROR'
  | 'INVALID_BLOCK'
  | 'INVALID_TRANSACTION'
  | 'INVALID_STATE_TRANSITION';

export type MachineError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
};

export const createMachineError = (
  code: ErrorCode,
  message: string,
  details?: unknown
): MachineError => ({
  code,
  message,
  details,
});

// State management
export interface State {
  readonly blockHeight: number;
  readonly latestHash: Hash;
  readonly stateRoot: Hash;
  readonly data: Map<string, unknown>;
  readonly nonces: Map<MachineId, number>;
  readonly parentId: MachineId | null;
  readonly childIds: ReadonlyArray<MachineId>;
}

// Message types
export interface Message<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: T;
  readonly timestamp: number;
  readonly sender: MachineId;
  readonly recipient: MachineId;
  readonly correlationId?: string;
  readonly causationId?: string;
}

// Machine Event type that combines all possible message types
export type MachineEvent = Message<Command | MessageEvent | Query | Response<unknown>>;

// Event types for internal use
export interface Event {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly sender?: MachineId;
  readonly target?: MachineId;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly machineId?: MachineId;
  readonly version?: number;
  readonly stateRoot?: Hash;
}

// Block types
export interface Block {
  readonly header: {
    readonly height: number;
    readonly timestamp: number;
    readonly prevHash: Hash;
    readonly stateRoot: Hash;
    readonly transactionsRoot: Hash;
    readonly proposer: MachineId;
  };
  readonly transactions: ReadonlyArray<Message>;
  readonly signatures: Map<MachineId, string>;
}

// Log level enum
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
} 