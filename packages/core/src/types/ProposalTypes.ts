import { Map } from 'immutable';
import { SignedTransaction, EntityConfig } from './MachineTypes';
import { MachineId, Block, Hash } from './Core';

export type ProposalId = string;

export type ProposalType = 
    | 'TRANSACTION' 
    | 'CONFIG_UPDATE'
    | 'BLOCK_PROPOSAL'
    | 'VALIDATOR_SET_UPDATE';

export type ProposalStatus = 
    | 'ACTIVE' 
    | 'EXECUTED' 
    | 'CANCELLED'
    | 'EXPIRED'
    | 'REJECTED';

export interface Proposal {
    readonly id: ProposalId;
    readonly proposer: MachineId;
    readonly type: ProposalType;
    readonly transaction?: SignedTransaction;
    readonly newConfig?: EntityConfig;
    readonly proposedBlock?: Block;
    readonly validatorUpdates?: Map<MachineId, number>; // validator -> weight
    readonly approvals: Map<MachineId, boolean>;
    readonly status: ProposalStatus;
    readonly timestamp: number;
    readonly expiresAt: number;
    readonly finalizedAt?: number;
    readonly result?: {
        readonly success: boolean;
        readonly stateRoot: Hash;
        readonly error?: string;
    };
}

export interface ProposalData {
    readonly proposals: Map<ProposalId, Proposal>;
    readonly activeProposals: Set<ProposalId>;
    readonly executedProposals: Set<ProposalId>;
    readonly rejectedProposals: Set<ProposalId>;
    readonly expiredProposals: Set<ProposalId>;
    readonly proposalsByType: Map<ProposalType, Set<ProposalId>>;
} 