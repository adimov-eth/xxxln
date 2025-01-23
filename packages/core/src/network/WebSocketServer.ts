import WebSocket from 'ws';
import { Map } from 'immutable';
import { Either, left, right } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

import { MachineError, Message, createMachineError } from '../types/Core';
import { ServerCommand, Event } from '../types/Messages';
import { BlockHash } from '../types/MachineTypes';

export type NodeInfo = {
  readonly id: string;
  readonly address: string;
  readonly port: number;
  readonly publicKey: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
};

export type NetworkMessage = {
  readonly type: 'HANDSHAKE' | 'BLOCK' | 'STATE_UPDATE' | 'PING';
  readonly data: unknown;
  readonly timestamp: number;
  readonly signature?: string;
};

export class WebSocketServer {
  private server: WebSocket.Server;
  private peers: Map<string, WebSocket> = Map();
  private nodeInfo: Map<string, NodeInfo> = Map();
  private messageHandlers: Map<string, (msg: NetworkMessage) => void> = Map();

  constructor(private readonly port: number) {
    this.server = new WebSocket.Server({ port });
    this.setupServer();
  }

  private setupServer(): void {
    this.server.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data) as NetworkMessage;
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        // Remove peer on disconnect
        const peerId = this.findPeerId(ws);
        if (peerId) {
          this.peers = this.peers.remove(peerId);
          this.nodeInfo = this.nodeInfo.update(peerId, info => info ? {
            id: info.id,
            address: info.address,
            port: info.port,
            publicKey: info.publicKey,
            status: 'INACTIVE' as const
          } : info);
        }
      });
    });
  }

  private findPeerId(ws: WebSocket): string | undefined {
    return Array.from(this.peers.entries())
      .find(([_, socket]) => socket === ws)?.[0];
  }

  private async handleMessage(ws: WebSocket, message: NetworkMessage): Promise<void> {
    switch (message.type) {
      case 'HANDSHAKE':
        await this.handleHandshake(ws, message);
        break;
      
      case 'BLOCK':
      case 'STATE_UPDATE':
        // Forward to registered handler
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        }
        break;
      
      case 'PING':
        ws.send(JSON.stringify({
          type: 'PONG',
          timestamp: Date.now()
        }));
        break;
    }
  }

  private async handleHandshake(ws: WebSocket, message: NetworkMessage): Promise<void> {
    const handshakeData = message.data as NodeInfo;
    
    // Store peer connection
    this.peers = this.peers.set(handshakeData.id, ws);
    this.nodeInfo = this.nodeInfo.set(handshakeData.id, {
      ...handshakeData,
      status: 'ACTIVE'
    });

    // Send our node info
    ws.send(JSON.stringify({
      type: 'HANDSHAKE',
      data: this.getNodeInfo(),
      timestamp: Date.now()
    }));
  }

  public broadcastMessage(message: NetworkMessage): void {
    const messageStr = JSON.stringify(message);
    this.peers.forEach(peer => {
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(messageStr);
      }
    });
  }

  public registerMessageHandler(
    type: string,
    handler: (msg: NetworkMessage) => void
  ): void {
    this.messageHandlers = this.messageHandlers.set(type, handler);
  }

  public getNodeInfo(): NodeInfo {
    return {
      id: process.env.NODE_ID || 'node_' + this.port,
      address: process.env.NODE_ADDRESS || 'localhost',
      port: this.port,
      publicKey: process.env.NODE_PUBLIC_KEY || '',
      status: 'ACTIVE'
    };
  }

  public getPeers(): Map<string, NodeInfo> {
    return this.nodeInfo;
  }

  public async connectToPeer(peerInfo: NodeInfo): Promise<Either<MachineError, void>> {
    try {
      const ws = new WebSocket(`ws://${peerInfo.address}:${peerInfo.port}`);
      
      return new Promise((resolve) => {
        ws.on('open', () => {
          // Send handshake
          ws.send(JSON.stringify({
            type: 'HANDSHAKE',
            data: this.getNodeInfo(),
            timestamp: Date.now()
          }));

          this.peers = this.peers.set(peerInfo.id, ws);
          this.nodeInfo = this.nodeInfo.set(peerInfo.id, {
            ...peerInfo,
            status: 'ACTIVE'
          });

          resolve(right(undefined));
        });

        ws.on('error', (error) => {
          resolve(left(createMachineError(
            'INTERNAL_ERROR',
            'Failed to connect to peer',
            error
          )));
        });
      });
    } catch (error) {
      return left(createMachineError(
        'INTERNAL_ERROR',
        'Failed to establish WebSocket connection',
        error
      ));
    }
  }

  public close(): void {
    this.server.close();
    this.peers.forEach(peer => peer.close());
  }
} 