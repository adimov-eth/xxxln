import { Map } from 'immutable';

// Basic types
export type MachineId = string;

// Error handling
export type ErrorCode = 
  | 'INVALID_STATE'
  | 'INVALID_MESSAGE'
  | 'INVALID_OPERATION'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

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