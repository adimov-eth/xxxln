import { Either, left, right } from 'fp-ts/Either';
import { WebSocket, WebSocketServer as WSServer, ServerOptions } from 'ws';
import { Map } from 'immutable';
import { pipe } from 'fp-ts/function';

import { MachineError, Message, createMachineError } from '../types/Core';
import { ServerCommand, Event } from '../types/Messages';
import { BlockHash } from '../types/MachineTypes';
import { Block } from '../types/BlockTypes';

type WS = WebSocket & { readyState: number };

// Explicitly type the constructors
const WS: typeof WebSocket & { new(url: string): WS } = WebSocket;
const WSS: typeof WSServer & { new(options: ServerOptions): WSServer } = WSServer;

export type NodeStatus = 'ACTIVE' | 'INACTIVE';

export interface NodeInfo {
  id: string;
  address: string;
  port: number;
  publicKey: string;
  status: NodeStatus;
}

export type NetworkMessageType = 
  | 'BLOCK' 
  | 'STATE_UPDATE' 
  | 'PING' 
  | 'PONG' 
  | 'REQUEST_PEERS'
  | 'PEERS_LIST'
  | 'DISCOVERY'
  | 'BLOCK_REQUEST'
  | 'REQUEST_BLOCK'
  | 'BLOCK_RESPONSE';

export interface NetworkMessage {
  type: string;
  payload: unknown;
  timestamp: number;
  peerId?: string;
}

export interface NetworkBlock {
  hash: string;
  data: unknown;
  signature?: string;
}

export class WebSocketServer {
  private readonly server: WSServer;
  private peers = Map<string, WS>();
  private messageHandlers = Map<string, (message: NetworkMessage) => void>();
  private readonly nodeId: string;
  private nodeInfo = Map<string, NodeInfo>();
  private pingTimers = Map<string, NodeJS.Timeout>();
  private readonly PING_INTERVAL = 30000; // 30 seconds
  private readonly PING_TIMEOUT = 5000;  // 5 seconds

  constructor(port: number, nodeId: string) {
    console.log(`[WebSocketServer] Initializing with nodeId: ${nodeId}`);
    this.nodeId = nodeId;
    const options: ServerOptions = { port };
    this.server = new WSS(options);
    this.setupServerHandlers();
    this.startPingInterval();
  }

  private setupServerHandlers(): void {
    this.server.on('connection', (socket: WS) => {
      socket.on('message', (data: string) => {
        try {
          const message = JSON.parse(data) as NetworkMessage;
          this.handleMessage(socket, message);
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });

      socket.on('close', () => {
        const peerId = this.findPeerId(socket);
        if (peerId) {
          this.removePeer(peerId);
        }
      });
    });
  }

  private removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.nodeInfo = this.nodeInfo.update(peerId, info => info ? {
      ...info,
      status: 'INACTIVE' as const
    } : info);
    
    // Clear ping timer
    const timer = this.pingTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.pingTimers = this.pingTimers.remove(peerId);
    }
  }

  private startPingInterval(): void {
    setInterval(() => {
      this.peers.forEach((ws: WS, peerId: string) => {
        this.sendPing(peerId, ws);
      });
    }, this.PING_INTERVAL);
  }

  private sendPing(peerId: string, ws: WS): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const pingMessage: NetworkMessage = {
      type: 'PING',
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
      peerId: this.nodeId
    };

    ws.send(JSON.stringify(pingMessage));

    // Set timeout for PONG response
    const timer = setTimeout(() => {
      console.warn(`Peer ${peerId} did not respond to ping, removing`);
      this.removePeer(peerId);
      ws.close();
    }, this.PING_TIMEOUT);

    this.pingTimers = this.pingTimers.set(peerId, timer);
  }

  private async handleMessage(ws: WS, message: NetworkMessage): Promise<void> {
    const peerId = message.peerId || this.findPeerId(ws);
    if (peerId) {
      this.updatePeerLastSeen(peerId);
    }

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler({ ...message, peerId });
      return;
    }

    switch (message.type) {
      case 'BLOCK':
      case 'STATE_UPDATE':
        this.messageHandlers.get(message.type)?.(message);
        break;
      
      case 'PING':
        this.handlePing(ws, message);
        break;

      case 'PONG':
        this.handlePong(peerId, message);
        break;

      case 'REQUEST_PEERS':
        this.handleRequestPeers(ws);
        break;

      case 'PEERS_LIST':
        await this.handlePeersList(message);
        break;

      case 'DISCOVERY':
        this.handleDiscovery(message);
        break;

      case 'BLOCK_REQUEST':
        this.handleBlockRequest(ws, message);
        break;

      case 'REQUEST_BLOCK':
        this.handleRequestBlock(ws, message);
        break;

      case 'BLOCK_RESPONSE':
        this.handleBlockResponse(ws, message);
        break;

      case 'HANDSHAKE':
        await this.handleHandshake(ws, message);
        break;
    }
  }

  private updatePeerLastSeen(peerId: string): void {
    this.nodeInfo = this.nodeInfo.update(peerId, info => 
      info ? { ...info, lastSeen: Date.now() } : info
    );
  }

  private handlePing(ws: WS, message: NetworkMessage): void {
    const pongMessage: NetworkMessage = {
      type: 'PONG',
      payload: { originalTimestamp: (message.payload as { timestamp: number }).timestamp },
      timestamp: Date.now(),
      peerId: this.nodeId
    };
    ws.send(JSON.stringify(pongMessage));
  }

  private handlePong(peerId: string | undefined, message: NetworkMessage): void {
    if (!peerId) return;

    // Clear ping timeout
    const timer = this.pingTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.pingTimers = this.pingTimers.remove(peerId);
    }

    // Calculate latency
    const originalTimestamp = (message.payload as { originalTimestamp: number }).originalTimestamp;
    const latency = Date.now() - originalTimestamp;

    // Update peer info with latency
    this.nodeInfo = this.nodeInfo.update(peerId, info =>
      info ? { ...info, latency } : info
    );
  }

  private handleRequestPeers(ws: WS): void {
    const activePeers = Array.from(this.nodeInfo.values())
      .filter(info => info.status === 'ACTIVE' && info.id !== this.nodeId)
      .map(({ id, address, port, publicKey }) => ({ id, address, port, publicKey }));

    const response: NetworkMessage = {
      type: 'PEERS_LIST',
      payload: { peers: activePeers },
      timestamp: Date.now(),
      peerId: this.nodeId
    };

    ws.send(JSON.stringify(response));
  }

  private async handlePeersList(message: NetworkMessage): Promise<void> {
    const { peers } = message.payload as { peers: Array<NodeInfo> };
    
    for (const peer of peers as NodeInfo[]) {
      if (peer.id !== this.nodeId && !this.nodeInfo.has(peer.id)) {
        await this.connectToPeer(peer);
      }
    }
  }

  private handleDiscovery(message: NetworkMessage): void {
    const peer = message.payload as NodeInfo;
    if (!this.nodeInfo.has(peer.id)) {
      this.connectToPeer(peer);
    }
  }

  private findPeerId(ws: WS): string | undefined {
    for (const [id, socket] of this.peers.entries()) {
      if (socket === ws) {
        return id;
      }
    }
    return undefined;
  }

  private async handleHandshake(ws: WS, message: NetworkMessage): Promise<void> {
    const handshakeData = message.payload as NodeInfo;
    
    // Store peer connection
    this.peers.set(handshakeData.id, ws);
    this.nodeInfo = this.nodeInfo.set(handshakeData.id, {
      ...handshakeData,
      status: 'ACTIVE'
    });

    // Send our node info
    ws.send(JSON.stringify({
      type: 'HANDSHAKE',
      payload: this.getNodeInfo(),
      timestamp: Date.now(),
      peerId: this.nodeId
    }));
  }

  public broadcastMessage(message: NetworkMessage): void {
    const messageWithPeerId = {
      ...message,
      peerId: this.nodeId
    };
    const messageStr = JSON.stringify(messageWithPeerId);
    this.peers.forEach((peer: WS) => {
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(messageStr);
      }
    });
  }

  public registerMessageHandler(
    type: string,
    handler: (msg: NetworkMessage) => void
  ): void {
    this.messageHandlers.set(type, handler);
  }

  public getNodeInfo(): NodeInfo {
    console.log(`[WebSocketServer] Getting node info for nodeId: ${this.nodeId}`);
    return {
      id: this.nodeId,
      address: 'localhost',
      port: (this.server.address() as { port: number }).port,
      publicKey: `key_${this.nodeId}`,
      status: 'ACTIVE'
    };
  }

  public getPeers(): Map<string, NodeInfo> {
    return this.nodeInfo;
  }

  public async connectToPeer(peerInfo: NodeInfo): Promise<Either<MachineError, void>> {
    if (peerInfo.id === this.nodeId) {
      return right(undefined);
    }

    try {
      const ws = new WS(`ws://${peerInfo.address}:${peerInfo.port}`) as WS;
      
      return new Promise((resolve) => {
        ws.on('open', () => {
          // Send handshake
          ws.send(JSON.stringify({
            type: 'HANDSHAKE',
            payload: this.getNodeInfo(),
            timestamp: Date.now(),
            peerId: this.nodeId
          }));

          this.peers.set(peerInfo.id, ws);
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
        'Failed to connect to peer',
        error
      ));
    }
  }

  public close(): void {
    this.peers.forEach((ws: WS) => ws.close());
    this.server.close();
  }

  private handleBlockRequest(ws: WS, message: NetworkMessage): void {
    const blockHash = message.payload as string;
    // TODO: Implement block retrieval and response
    console.log(`Block request received for hash: ${blockHash}`);
  }

  public sendResponseBlock(ws: WS, block: NetworkBlock): void {
    const message: NetworkMessage = {
      type: 'BLOCK_RESPONSE',
      payload: block,
      timestamp: Date.now()
    };
    ws.send(JSON.stringify(message));
  }

  private handleRequestBlock(ws: WS, message: NetworkMessage): void {
    const blockHash = message.payload as string;
    // TODO: Implement block retrieval and response
    console.log(`Block request received for hash: ${blockHash}`);
  }

  private handleBlockResponse(ws: WS, message: NetworkMessage): void {
    const block = message.payload as NetworkBlock;
    // TODO: Implement block response handling
    console.log(`Block response received for hash: ${block.hash}`);
  }

  public getPeerSocket(peerId: string): WS | undefined {
    return this.peers.get(peerId);
  }
} 