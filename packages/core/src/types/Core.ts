import { Map } from 'immutable';

// Basic types
export type MachineId = string;

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
  | 'INVALID_SIGNATURE'
  | 'INVALID_PROPOSAL'
  | 'UNAUTHORIZED'
  | 'INVALID_COMMAND'
  | 'INVALID_EVENT'
  | 'INVALID_MESSAGE'
  | 'INVALID_OPERATION'
  | 'VALIDATION_ERROR'
  | 'INVALID_CONFIG'
  | 'NETWORK_ERROR';

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
export type State = Map<string, unknown>;

// Message types
export type Message<T = unknown> = {
  readonly id: string;
  readonly type: string;
  readonly payload: T;
  readonly timestamp: number;
  readonly sender: MachineId;
  readonly recipient: MachineId;
  readonly correlationId?: string;
  readonly causationId?: string;
};

// Event types
export type MachineEvent = {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly sender?: MachineId;
  readonly target?: MachineId;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
};

// Log level enum
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
} 