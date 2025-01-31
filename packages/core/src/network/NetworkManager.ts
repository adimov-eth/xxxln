import { Map } from 'immutable';
import { Either, left, right } from 'fp-ts/Either';
import { map } from 'fp-ts/lib/Either';
import { pipe } from 'fp-ts/function';
import { EventEmitter } from 'events';

import { MachineError, Message, createMachineError } from '../types/Core';
import { ServerCommand, Event } from '../types/Messages';
import { BlockHash, ServerState } from '../types/MachineTypes';
import { WebSocketServer, NodeInfo, NetworkMessage, NetworkBlock } from './WebSocketServer';
import { NetworkConditions, NodeMetrics } from '../types/NodeOrchestrator'
import { LogLevel } from '../types/Core';
import { EventBus } from '../eventbus/EventBus';

export class NetworkManager extends EventEmitter {
  private readonly wsServer: WebSocketServer;
  private knownPeers: Map<string, NodeInfo> = Map();
  private readonly blockHandlers: Array<(block: unknown) => void> = [];
  private readonly stateHandlers: Array<(state: unknown) => void> = [];
  private readonly blockRequestHandlers: Array<(hash: string) => Promise<NetworkBlock | undefined>> = [];
  private readonly PEER_DISCOVERY_INTERVAL = 300000; // 5 minutes
  private readonly nodeInfo: NodeInfo;
  private readonly id: string;
  private readonly peers: string[];
  private isRunning: boolean = false;

  constructor(
    private readonly port: number,
    private readonly initialPeers: Array<NodeInfo>,
    private readonly nodeId: string,
    private readonly eventBus: EventBus,
    private readonly logLevel: LogLevel
  ) {
    super();
    console.log(`[NetworkManager] Initializing with nodeId: ${nodeId}`);
    this.wsServer = new WebSocketServer(port, nodeId);
    this.nodeInfo = {
      id: nodeId,
      address: 'localhost',
      port,
      publicKey: `key_${nodeId}`,
      status: 'ACTIVE'
    };
    console.log(`[NetworkManager] Created with nodeInfo:`, this.nodeInfo);
    this.setupMessageHandlers();
    // Wait for server to be ready before connecting to peers
    setTimeout(() => {
      this.connectToInitialPeers();
      this.startPeerDiscovery();
    }, 1000);
    this.id = nodeId;
    this.peers = initialPeers.map(p => p.id);
  }

  private setupMessageHandlers(): void {
    // Handle block messages
    this.wsServer.registerMessageHandler('BLOCK', (message: NetworkMessage) => {
      console.log(`[NetworkManager] Received block message from peer ${message.peerId}`);
      
      // Extract block from message payload
      const networkBlock = message.payload as NetworkBlock;
      console.log(`[NetworkManager] Processing network block:`, networkBlock);
      
      if (!networkBlock || typeof networkBlock !== 'object') {
        console.error('[NetworkManager] Invalid network block format:', networkBlock);
        return;
      }

      if (!networkBlock.hash || !networkBlock.data) {
        console.error('[NetworkManager] Network block missing required fields:', networkBlock);
        return;
      }

      // Pass the block to handlers
      this.blockHandlers.forEach(handler => {
        try {
          handler(networkBlock);
        } catch (error) {
          console.error(`[NetworkManager] Error in block handler:`, error);
        }
      });

      // Relay block to other peers
      if (message.peerId !== this.id) {
        console.log(`[NetworkManager] Relaying block ${networkBlock.hash} to other peers`);
        this.broadcastBlock(networkBlock);
      }
    });

    // Handle state update messages
    this.wsServer.registerMessageHandler('STATE_UPDATE', (message: NetworkMessage) => {
      console.log(`[NetworkManager] Received state update from peer ${message.peerId}`);
      this.stateHandlers.forEach(handler => handler(message.payload));
    });

    // Handle block requests
    this.wsServer.registerMessageHandler('REQUEST_BLOCK', async (message: NetworkMessage) => {
      console.log(`[NetworkManager] Received block request from peer ${message.peerId}`);
      const hash = message.payload as string;
      if (this.blockRequestHandlers.length > 0) {
        const block = await this.blockRequestHandlers[0]!(hash);
        if (block && message.peerId) {
          const socket = this.wsServer.getPeerSocket(message.peerId);
          if (socket) {
            console.log(`[NetworkManager] Sending requested block ${hash} to peer ${message.peerId}`);
            this.wsServer.sendResponseBlock(socket, block);
          }
        }
      }
    });

    // Handle block responses
    this.wsServer.registerMessageHandler('BLOCK_RESPONSE', (message: NetworkMessage) => {
      console.log(`[NetworkManager] Received block response from peer ${message.peerId}`);
      const block = message.payload as NetworkBlock;
      this.blockHandlers.forEach(handler => handler(block));
    });
  }

  private async connectToInitialPeers(): Promise<void> {
    for (const peer of this.initialPeers) {
      try {
        await this.connectToPeer(peer);
        // Wait a bit between connections
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to connect to peer ${peer.id}:`, error);
      }
    }
    
    // Request peer lists from initial connections
    this.requestPeersFromAll();
  }

  private startPeerDiscovery(): void {
    setInterval(() => {
      this.requestPeersFromRandom();
    }, this.PEER_DISCOVERY_INTERVAL);
  }

  private requestPeersFromAll(): void {
    this.wsServer.broadcastMessage({
      type: 'REQUEST_PEERS',
      payload: {},
      timestamp: Date.now()
    });
  }

  private requestPeersFromRandom(): void {
    const peers = Array.from(this.knownPeers.values())
      .filter(peer => peer.status === 'ACTIVE');
    
    if (peers.length === 0) return;

    // Pick a random peer
    const randomPeer = peers[Math.floor(Math.random() * peers.length)];
    
    this.wsServer.broadcastMessage({
      type: 'REQUEST_PEERS',
      payload: {},
      timestamp: Date.now()
    });
  }

  public async connectToPeer(peer: NodeInfo): Promise<Either<MachineError, void>> {
    if (this.knownPeers.has(peer.id)) {
      return right(undefined);
    }

    const result = await this.wsServer.connectToPeer(peer);
    if (result._tag === 'Right') {
      this.knownPeers = this.knownPeers.set(peer.id, peer);
    }
    return result;
  }

  public handleLocalBlock(networkBlock: NetworkBlock): void {
    console.log(`[NetworkManager] Processing local block ${networkBlock.hash}`);
    
    // Manually invoke the same onBlock handlers the node would
    // normally invoke if it had received the block over the network
    this.blockHandlers.forEach(handler => {
      try {
        handler(networkBlock);
      } catch (error) {
        console.error(`[NetworkManager] Error in block handler:`, error);
      }
    });
  }

  public broadcastBlock(block: NetworkBlock): void {
    console.log(`[NetworkManager] Broadcasting block:`, block);
    const message: NetworkMessage = {
      type: 'BLOCK',
      payload: block,
      timestamp: Date.now(),
      peerId: this.id
    };
    this.wsServer.broadcastMessage(message);

    // Also deliver the block to ourselves so our local chain updates
    this.handleLocalBlock(block);
  }

  public broadcastStateUpdate(state: unknown): void {
    const message: NetworkMessage = {
      type: 'STATE_UPDATE',
      payload: state,
      timestamp: Date.now()
    };
    this.wsServer.broadcastMessage(message);
  }

  public requestBlock(hash: string): void {
    const message: NetworkMessage = {
      type: 'REQUEST_BLOCK',
      payload: hash,
      timestamp: Date.now()
    };
    this.wsServer.broadcastMessage(message);
  }

  public onBlock(handler: (block: unknown) => void): void {
    this.blockHandlers.push(handler);
  }

  public onStateUpdate(handler: (state: unknown) => void): void {
    this.stateHandlers.push(handler);
  }

  public onBlockRequest(handler: (hash: string) => Promise<NetworkBlock | undefined>): void {
    this.blockRequestHandlers.push(handler);
  }

  public getPeers(): Map<string, NodeInfo> {
    return this.knownPeers;
  }

  public getNodeInfo(): NodeInfo {
    return this.nodeInfo;
  }

  public close(): void {
    this.wsServer.close();
  }

  /**
   * Stop the network manager and clean up resources
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.removeAllListeners();
  }

  /**
   * Attempt to reconnect to peers
   */
  async reconnect(): Promise<void> {
    if (!this.isRunning) {
      this.isRunning = true;
      // Implement reconnection logic
    }
  }

  /**
   * Set network conditions for testing
   */
  setNetworkConditions(conditions: NetworkConditions): void {
    // Implement network condition simulation
  }

  /**
   * Get current metrics
   */
  async getMetrics(): Promise<NodeMetrics> {
    return {
      blockHeight: 0,
      peersCount: this.peers.length,
      lastBlockTime: Date.now(),
      pendingTransactions: 0,
      networkLatency: 0,
      syncStatus: 'ACTIVE'
    };
  }
} 