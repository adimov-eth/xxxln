import { Map } from 'immutable';
import { SignedTransaction, EntityConfig } from './MachineTypes';
import { MachineId } from './Core';

export type ProposalId = string;

export type ProposalType = 'TRANSACTION' | 'CONFIG_UPDATE';

export type ProposalStatus = 'ACTIVE' | 'EXECUTED' | 'CANCELLED';

export interface Proposal {
  readonly id: ProposalId;
  readonly proposer: MachineId;
  readonly type: ProposalType;
  readonly transaction?: SignedTransaction;
  readonly newConfig?: EntityConfig;
  readonly approvals: Map<MachineId, boolean>;
  readonly status: ProposalStatus;
  readonly timestamp: number;
  readonly expiresAt?: number;
}

export interface ProposalData {
  readonly proposals: Map<ProposalId, Proposal>;
} 