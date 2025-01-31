import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { io } from "socket.io-client";

// Types
type NodeType = 'signer' | 'entity' | 'other';

interface NodeConfig {
  readonly id: string;
  readonly type: NodeType;
  readonly privateKey?: string;
  readonly peers: ReadonlyArray<string>;
  readonly port: number;
  readonly host: string;
  readonly isBootstrap?: boolean;
}

interface BlockchainState {
  readonly height: number;
  readonly balances: Record<string, number>;
  readonly tipHash: string | null;
}

interface DashboardUpdate {
  readonly nodeStates: Record<string, BlockchainState>;
  readonly nodeConfigs: ReadonlyArray<NodeConfig>;
}

// Helper to truncate hash
const truncateHash = (hash: string | null) => 
  hash ? `${hash.substring(0, 10)}...` : 'null';

// Log Entry Component
const LogEntry = ({ message }: { message: string }) => {
  const getLogClass = () => {
    if (message.startsWith('[DEBUG]')) return 'text-gray-400';
    if (message.includes('<--')) return 'text-blue-400';
    if (message.match(/\[node_\d+\]/)) return 'text-green-400';
    return 'text-gray-200';
  };

  return (
    <div className={`font-mono text-sm py-1 ${getLogClass()}`}>
      {message}
    </div>
  );
};

// Node Card Component
const NodeCard = ({ 
  nodeId, 
  state, 
  config 
}: { 
  nodeId: string;
  state: BlockchainState;
  config: NodeConfig;
}) => (
  <Card className="w-full">
    <CardHeader className="pb-2">
      <div className="flex justify-between items-center">
        <CardTitle className="text-lg">{nodeId}</CardTitle>
        <div className="flex gap-2">
          <span className={`px-2 py-1 rounded text-xs font-bold text-white
            ${config.type === 'signer' ? 'bg-red-500' : 'bg-blue-500'}`}>
            {config.type.toUpperCase()}
          </span>
          {config.isBootstrap && (
            <span className="px-2 py-1 rounded text-xs font-bold text-white bg-purple-500">
              BOOTSTRAP
            </span>
          )}
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        <div>
          <h3 className="text-sm text-gray-500">Height</h3>
          <p className="text-lg font-semibold">{state.height}</p>
        </div>
        
        <div>
          <h3 className="text-sm text-gray-500">Tip Hash</h3>
          <div className="bg-gray-100 p-2 rounded text-xs font-mono">
            {truncateHash(state.tipHash)}
          </div>
        </div>
        
        <div>
          <h3 className="text-sm text-gray-500 mb-2">Balances</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(state.balances).map(([account, amount]) => (
              <div key={account} className="bg-gray-100 p-2 rounded text-sm">
                <span className="font-mono">{account}: {amount}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm text-gray-500 mb-2">Peers</h3>
          <div className="flex flex-wrap gap-2">
            {config.peers.map(peer => (
              <span key={peer} className="px-2 py-1 bg-gray-100 rounded text-xs">
                {peer}
              </span>
            ))}
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

// Main App Component
export default function App() {
  const [networkState, setNetworkState] = useState<DashboardUpdate | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const socket = io('http://localhost:3100');

    socket.on('networkState', (update: DashboardUpdate) => {
      setNetworkState(update);
    });

    socket.on('log', (message: string) => {
      setLogs(prev => [...prev, message].slice(-100)); // Keep last 100 logs
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  if (!networkState) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Connecting to network...</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Network Dashboard</h1>
        
        {/* Node Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(networkState.nodeStates).map(([nodeId, state]) => {
            const config = networkState.nodeConfigs.find(c => c.id === nodeId);
            if (!config) return null;
            return (
              <NodeCard
                key={nodeId}
                nodeId={nodeId}
                state={state}
                config={config}
              />
            );
          })}
        </div>

        {/* Logs Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Network Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] overflow-y-auto bg-gray-900 text-gray-100 p-4 rounded">
              {logs.map((log, i) => (
                <LogEntry key={i} message={log} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
