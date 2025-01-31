import { Map } from 'immutable';
import { Either, left, right } from 'fp-ts/Either';
import { map } from 'fp-ts/lib/Either';
import { pipe } from 'fp-ts/function';

import { MachineError, Message, createMachineError } from '../types/Core';
import { ServerCommand, Event } from '../types/Messages';
import { BlockHash, ServerState } from '../types/MachineTypes';
import { WebSocketServer, NodeInfo, NetworkMessage, NetworkBlock } from './WebSocketServer';

export class NetworkManager {
  private readonly wsServer: WebSocketServer;
  private knownPeers: Map<string, NodeInfo> = Map();
  private readonly blockHandlers: Array<(block: unknown) => void> = [];
  private readonly stateHandlers: Array<(state: unknown) => void> = [];
  private readonly blockRequestHandlers: Array<(hash: string) => Promise<NetworkBlock | undefined>> = [];
  private readonly PEER_DISCOVERY_INTERVAL = 300000; // 5 minutes
  private readonly nodeInfo: NodeInfo;

  constructor(
    private readonly port: number,
    private readonly initialPeers: Array<NodeInfo> = [],
    private readonly nodeId: string
  ) {
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
  }

  private setupMessageHandlers(): void {
    // Handle block messages
    this.wsServer.registerMessageHandler('BLOCK', (message: NetworkMessage) => {
      this.blockHandlers.forEach(handler => handler(message.payload));
    });

    // Handle state update messages
    this.wsServer.registerMessageHandler('STATE_UPDATE', (message: NetworkMessage) => {
      this.stateHandlers.forEach(handler => handler(message.payload));
    });

    // Handle block requests
    this.wsServer.registerMessageHandler('REQUEST_BLOCK', async (message: NetworkMessage) => {
      const hash = message.payload as string;
      if (this.blockRequestHandlers.length > 0) {
        const block = await this.blockRequestHandlers[0]!(hash);
        if (block && message.peerId) {
          const socket = this.wsServer.getPeerSocket(message.peerId);
          if (socket) {
            this.wsServer.sendResponseBlock(socket, block);
          }
        }
      }
    });

    // Handle block responses
    this.wsServer.registerMessageHandler('BLOCK_RESPONSE', (message: NetworkMessage) => {
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

  public broadcastBlock(block: NetworkBlock): void {
    const message: NetworkMessage = {
      type: 'BLOCK',
      payload: block,
      timestamp: Date.now()
    };
    this.wsServer.broadcastMessage(message);
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
} 