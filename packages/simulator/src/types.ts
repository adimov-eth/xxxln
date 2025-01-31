import { NetworkBlock } from '@xxxln/core';
import { Map } from 'immutable';

// Node roles
export type NodeRole = 'VALIDATOR' | 'OBSERVER';

// Node configuration
export interface NodeConfig {
  readonly id: string;
  readonly type: 'signer' | 'entity';
  readonly privateKey: string;
  readonly peers: ReadonlyArray<string>;
  readonly isBootstrap?: boolean;
  readonly port: number;
  readonly host: string;
}

// Account type
export type Account = 'account1' | 'account2' | 'account3' | 'account4';

// Node's local chain state - using Immutable.Map for mutable state
export type BlockchainState = {
  height: number;
  balances: Map<Account, number>;
  blocks: Map<string, NetworkBlock>;
  tipHash: string | null;
};

// Helper to create initial blockchain state
export const createInitialState = (): BlockchainState => ({
  height: 0,
  balances: Map<Account, number>({
    account1: 1000,
    account2: 1000,
    account3: 1000,
    account4: 1000
  }),
  blocks: Map<string, NetworkBlock>(),
  tipHash: null
});

// Basic transaction
export type Transaction = {
  readonly id: string;
  readonly from: Account;
  readonly to: Account;
  readonly amount: number;
  readonly timestamp: number;
};

export type DashboardUpdate = {
  readonly nodeStates: Record<string, BlockchainState>;
  readonly nodeConfigs: ReadonlyArray<NodeConfig>;
}; 