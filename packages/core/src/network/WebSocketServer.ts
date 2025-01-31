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
  private seenMessages = new Set<string>();

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
      console.log(`[WebSocketServer] New connection received`);
      
      // Initialize connection with handshake
      const handshakeMessage = {
        type: 'HANDSHAKE',
        payload: this.getNodeInfo(),
        timestamp: Date.now(),
        peerId: this.nodeId
      };
      socket.send(JSON.stringify(handshakeMessage));
      
      socket.on('message', (data: string) => {
        try {
          const message = JSON.parse(data) as NetworkMessage;
          
          // Handle handshake response
          if (message.type === 'HANDSHAKE') {
            const peerInfo = message.payload as NodeInfo;
            this.peers = this.peers.set(peerInfo.id, socket);
            this.nodeInfo = this.nodeInfo.set(peerInfo.id, {
              ...peerInfo,
              status: 'ACTIVE'
            });
            console.log(`[WebSocketServer] Peer ${peerInfo.id} connected. Active peers count: ${this.peers.size}`);
          } else {
            console.log(`[WebSocketServer] Received ${message.type} from peer ${message.peerId}`);
          }
          
          this.handleMessage(socket, message);
        } catch (error) {
          console.error('[WebSocketServer] Error handling message:', error);
        }
      });

      socket.on('close', () => {
        const peerId = this.findPeerId(socket);
        if (peerId) {
          console.log(`[WebSocketServer] Peer ${peerId} disconnected`);
          this.peers = this.peers.remove(peerId);
          this.nodeInfo = this.nodeInfo.update(peerId, info => info ? {
            ...info,
            status: 'INACTIVE' as const
          } : info);
        }
      });

      socket.on('error', (error) => {
        const peerId = this.findPeerId(socket);
        console.error(`[WebSocketServer] Socket error for peer ${peerId}:`, error);
      });
    });

    this.server.on('error', (error) => {
      console.error('[WebSocketServer] Server error:', error);
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

    switch (message.type) {
      case 'BLOCK': {
        const networkBlock = message.payload as NetworkBlock;
        const seenKey = `block:${networkBlock.hash}`;
        
        if (!this.seenMessages.has(seenKey)) {
          console.log(`[WebSocketServer] Processing new block ${networkBlock.hash} from ${peerId}`);
          this.seenMessages.add(seenKey);
          
          // Process block via handler
          const blockHandler = this.messageHandlers.get('BLOCK');
          if (blockHandler) {
            blockHandler({ ...message, peerId });
            console.log(`[WebSocketServer] Block ${networkBlock.hash} processed locally`);
          }
          
          // Relay to other peers
          const relayMessage = {
            type: 'BLOCK',
            payload: networkBlock,
            timestamp: Date.now(),
            peerId: this.nodeId
          };
          
          let relayCount = 0;
          this.peers.forEach((peer: WS, otherPeerId: string) => {
            if (otherPeerId !== peerId && peer.readyState === WebSocket.OPEN) {
              try {
                peer.send(JSON.stringify(relayMessage));
                relayCount++;
              } catch (error) {
                console.error(`[WebSocketServer] Failed to relay block to ${otherPeerId}:`, error);
              }
            }
          });
          console.log(`[WebSocketServer] Block ${networkBlock.hash} relayed to ${relayCount} peers`);
        } else {
          console.log(`[WebSocketServer] Already processed block ${networkBlock.hash}`);
        }
        break;
      }
      
      case 'STATE_UPDATE':
        this.messageHandlers.get('STATE_UPDATE')?.(message);
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

      default:
        console.warn(`[WebSocketServer] Unknown message type: ${message.type}`);
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

  private findPeerId(socket: WS): string | undefined {
    const entry = this.peers.findEntry(peer => peer === socket);
    return entry ? entry[0] : undefined;
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

  public broadcastMessage(message: NetworkMessage, excludePeerId?: string): void {
    const messageWithPeerId = {
      ...message,
      peerId: this.nodeId
    };
    const messageStr = JSON.stringify(messageWithPeerId);
    
    if (message.type === 'BLOCK') {
      console.log(`[WebSocketServer] Broadcasting BLOCK ${(message.payload as NetworkBlock).hash} to ${this.peers.size} peers`);
    }
    
    let sentCount = 0;
    this.peers.forEach((peer: WS, peerId: string) => {
      if (peerId !== excludePeerId && peer.readyState === WebSocket.OPEN) {
        try {
          peer.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error(`[WebSocketServer] Failed to send to peer ${peerId}:`, error);
          this.peers = this.peers.remove(peerId);
          this.nodeInfo = this.nodeInfo.update(peerId, info => info ? {
            ...info,
            status: 'INACTIVE' as const
          } : info);
        }
      }
    });
    
    if (message.type === 'BLOCK') {
      console.log(`[WebSocketServer] Block broadcast complete. Sent to ${sentCount} peers`);
    }
  }

  public registerMessageHandler(
    type: string,
    handler: (msg: NetworkMessage) => void
  ): void {
    this.messageHandlers.set(type, handler);
  }

  public getNodeInfo(): NodeInfo {
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

  public async connectToPeer(peer: NodeInfo): Promise<Either<MachineError, void>> {
    try {
      console.log(`[WebSocketServer] Connecting to peer ${peer.id} at ws://${peer.address}:${peer.port}`);
      const ws = new WebSocket(`ws://${peer.address}:${peer.port}`);
      
      return new Promise((resolve) => {
        ws.on('open', () => {
          // Send handshake
          const handshakeMessage = {
            type: 'HANDSHAKE',
            payload: this.getNodeInfo(),
            timestamp: Date.now(),
            peerId: this.nodeId
          };
          ws.send(JSON.stringify(handshakeMessage));
          
          // Add to peers
          this.peers = this.peers.set(peer.id, ws);
          this.nodeInfo = this.nodeInfo.set(peer.id, {
            ...peer,
            status: 'ACTIVE'
          });
          
          console.log(`[WebSocketServer] Successfully connected to peer ${peer.id}`);
          resolve(right(undefined));
        });

        ws.on('error', (error) => {
          console.error(`[WebSocketServer] Error connecting to peer ${peer.id}:`, error);
          resolve(left({
            type: 'NETWORK_ERROR',
            code: 'INTERNAL_ERROR',
            message: `Failed to connect to peer ${peer.id}`
          }));
        });
      });
    } catch (error) {
      return left({
        type: 'NETWORK_ERROR', 
        code: 'INTERNAL_ERROR',
        message: `Failed to connect to peer ${peer.id}`
      });
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