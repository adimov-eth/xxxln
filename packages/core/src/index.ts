// Network exports
export * from './network/NetworkManager';
export type { 
  NodeInfo, 
  NetworkMessage, 
  NetworkBlock
} from './network/WebSocketServer';

// Event bus exports
export * from './eventbus/EventBus';

// Type exports
export * from './types/BlockTypes';
export * from './types/Core';
export * from './types/Messages';
export * from './types/MachineTypes';
export type { 
  PublicKey,
  SignatureData,
} from './types/BlockTypes';
export type { MachineError } from './types/Core';
export { createMachineError } from './types/Core';
export { LogLevel } from './types/Core';

// Crypto exports
export { KeyStorage, getKeyStorage } from './crypto/KeyStorage';
export { createEcdsaSignature, verifyEcdsaSignature, derivePublicKey } from './crypto/EcdsaSignatures';

// Hierarchy Management exports
export {
  createEntityForSigner,
  attachEntityToServer,
  connectSignerToEntity,
  registerEntityOnEventBus
} from './state/HierarchyManager';

// Node Orchestrator exports
export {
  createNodeManagers,
  initializeNodeNetwork,
  stopNodeNetwork,
  subscribeToNodeEvents,
  runBlockProductionLoop,
  createTestNetwork,
  simulateNetworkConditions,
  runNetworkScenario,
  setLogLevel,
  checkNodeHealth,
  reconnectFailedNodes
} from './api/NodeOrchestrator';

// Node Orchestrator Types exports
export type {
  NodeHealth,
  NodeConfig,
  NodeMetrics,
  NetworkState,
  NetworkTopology,
  NetworkConditions,
  NetworkScenario,
  NodeEventHandler,
  OrchestratorNodeConfig
} from './api/NodeOrchestrator'; 