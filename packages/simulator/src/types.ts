import { NetworkBlock, NodeHealth, NetworkState } from '@xxxln/core';
import type { Transaction } from '@xxxln/core/src/types/MachineTypes';
import { Map } from 'immutable';

// Node roles
export type NodeRole = 'VALIDATOR' | 'OBSERVER';

// Node configuration
export interface NodeConfig {
  readonly id: string;
  readonly type: 'signer' | 'entity' | 'other';
  readonly privateKey: string;
  readonly peers: ReadonlyArray<string>;
  readonly port: number;
  readonly host: string;
  readonly isBootstrap?: boolean;
}

// Account type
export type Account = string;

// Node's local chain state - using Immutable.Map for mutable state
export type BlockchainState = {
  readonly height: number;
  readonly balances: Map<Account, number>;
  readonly blocks: Map<string, NetworkBlock>;
  readonly tipHash: string | null;
};

// Dashboard-friendly state type
export type DashboardBlockchainState = {
  readonly height: number;
  readonly balances: Record<Account, number>;
  readonly tipHash: string | null;
  readonly pendingTransactions?: ReadonlyArray<Transaction>;
};

// Helper to convert blockchain state to dashboard state
export const toDashboardState = (state: BlockchainState, pending?: ReadonlyArray<Transaction>): DashboardBlockchainState => ({
  height: state.height,
  balances: Object.fromEntries(state.balances) as Record<Account, number>,
  tipHash: state.tipHash,
  ...(pending ? { pendingTransactions: pending } : {})
});

// Helper to create initial blockchain state
export const createInitialState = (): BlockchainState => ({
  height: 0,
  tipHash: null,
  balances: Map<Account, number>({
    account1: 1000,
    account2: 0,
    account3: 0,
    account4: 0
  }),
  blocks: Map<string, NetworkBlock>()
});

export interface DashboardUpdate {
  readonly nodeStates: Record<string, DashboardBlockchainState>;
  readonly nodeConfigs: ReadonlyArray<NodeConfig>;
}; 