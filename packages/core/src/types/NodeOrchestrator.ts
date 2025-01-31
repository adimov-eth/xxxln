import { Either } from 'fp-ts/Either';
import { MachineError } from './Core';
import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../eventbus/EventBus';

export type NodeRole = 'VALIDATOR' | 'OBSERVER' | 'SIGNER' | 'ENTITY';
export type NetworkState = 'SYNCING' | 'ACTIVE' | 'DISCONNECTED';
export type NetworkTopology = 'MESH' | 'STAR' | 'RING';

export interface NodeOrchestratorConfig {
  readonly blockProductionInterval: number;
  readonly maxTransactionsPerBlock: number;
  readonly networkTimeout: number;
  readonly retryAttempts: number;
  readonly topology: NetworkTopology;
}

export interface NodeConfig {
  readonly id: string;
  readonly type: 'signer' | 'entity' | 'other';
  readonly privateKey?: string;
  readonly peers: ReadonlyArray<string>;
  readonly port: number;
  readonly host: string;
  readonly isBootstrap?: boolean;
}

export interface NodeMetrics {
  readonly blockHeight: number;
  readonly peersCount: number;
  readonly lastBlockTime: number;
  readonly pendingTransactions: number;
  readonly networkLatency: number;
  readonly syncStatus: NetworkState;
}

export interface NodeHealth {
  readonly isHealthy: boolean;
  readonly lastSeen: number;
  readonly errors: ReadonlyArray<string>;
  readonly metrics: NodeMetrics;
}

export interface NetworkConditions {
  readonly latency: number;
  readonly packetLoss: number;
  readonly partition?: boolean;
}

export interface NetworkScenario {
  readonly scenario: 'PARTITION' | 'LATENCY' | 'PACKET_LOSS';
  readonly duration: number;
  readonly healNetwork: boolean;
  readonly conditions?: NetworkConditions;
}

export interface NetworkMessage<T = unknown> {
  readonly type: string;
  readonly payload: T;
  readonly signature: string;
  readonly timestamp: number;
  readonly sender: string;
  readonly target?: string;
}

export type NodeEventHandler = (nodeId: string, event: NetworkMessage) => void;

export interface HierarchyConfig {
  readonly validators: ReadonlyArray<string>;
  readonly signers: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<{
    readonly id: string;
    readonly signers: ReadonlyArray<string>;
    readonly threshold: number;
  }>;
}

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
} 