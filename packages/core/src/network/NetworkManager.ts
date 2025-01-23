import { Map } from 'immutable';
import { Either, left, right, map } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

import { MachineError, Message, createMachineError } from '../types/Core';
import { ServerCommand, Event } from '../types/Messages';
import { BlockHash, ServerState } from '../types/MachineTypes';
import { WebSocketServer, NodeInfo, NetworkMessage } from './WebSocketServer';

export class NetworkManager {
  private readonly wsServer: WebSocketServer;
  private knownPeers: Map<string, NodeInfo> = Map();
  private readonly blockHandlers: Array<(block: unknown) => void> = [];
  private readonly stateHandlers: Array<(state: unknown) => void> = [];

  constructor(
    private readonly port: number,
    private readonly initialPeers: Array<NodeInfo> = []
  ) {
    this.wsServer = new WebSocketServer(port);
    this.setupMessageHandlers();
    this.connectToInitialPeers();
  }

  private setupMessageHandlers(): void {
    // Handle block messages
    this.wsServer.registerMessageHandler('BLOCK', (msg: NetworkMessage) => {
      this.blockHandlers.forEach(handler => handler(msg.data));
    });

    // Handle state update messages
    this.wsServer.registerMessageHandler('STATE_UPDATE', (msg: NetworkMessage) => {
      this.stateHandlers.forEach(handler => handler(msg.data));
    });
  }

  private async connectToInitialPeers(): Promise<void> {
    for (const peer of this.initialPeers) {
      await this.connectToPeer(peer);
    }
  }

  public async connectToPeer(peer: NodeInfo): Promise<Either<MachineError, void>> {
    // Don't connect if already connected
    if (this.knownPeers.has(peer.id)) {
      return right(undefined);
    }

    return pipe(
      await this.wsServer.connectToPeer(peer),
      map(() => {
        this.knownPeers = this.knownPeers.set(peer.id, peer);
      })
    );
  }

  public broadcastBlock(block: unknown): void {
    this.wsServer.broadcastMessage({
      type: 'BLOCK',
      data: block,
      timestamp: Date.now()
    });
  }

  public broadcastStateUpdate(state: unknown): void {
    this.wsServer.broadcastMessage({
      type: 'STATE_UPDATE',
      data: state,
      timestamp: Date.now()
    });
  }

  public onBlock(handler: (block: unknown) => void): void {
    this.blockHandlers.push(handler);
  }

  public onStateUpdate(handler: (state: unknown) => void): void {
    this.stateHandlers.push(handler);
  }

  public getPeers(): Map<string, NodeInfo> {
    return this.knownPeers;
  }

  public getNodeInfo(): NodeInfo {
    return this.wsServer.getNodeInfo();
  }

  public close(): void {
    this.wsServer.close();
  }
} 