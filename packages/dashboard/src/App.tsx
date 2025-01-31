import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { io } from "socket.io-client";

// Types
type NodeRole = 'VALIDATOR' | 'OBSERVER';
type Account = 'account1' | 'account2' | 'account3' | 'account4';

type NodeConfig = {
  port: number;
  id: string;
  address: string;
  role: NodeRole;
};

type BlockchainState = {
  height: number;
  balances: Record<Account, number>;
  tipHash: string | null;
};

type DashboardUpdate = {
  nodeStates: Record<string, BlockchainState>;
  nodeConfigs: NodeConfig[];
};

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
        <span className={`px-2 py-1 rounded text-xs font-bold text-white
          ${config.role === 'VALIDATOR' ? 'bg-red-500' : 'bg-blue-500'}`}>
          {config.role}
        </span>
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
      </div>
    </CardContent>
  </Card>
);

// Main Dashboard Component
const BlockchainDashboard = () => {
  const [networkState, setNetworkState] = useState<DashboardUpdate | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const socket = io('http://localhost:4000');

    socket.on('connect', () => {
      console.log('Connected to simulator');
    });

    socket.on('networkState', (update: DashboardUpdate) => {
      setNetworkState(update);
    });

    socket.on('log', (message: string) => {
      setLogs(prev => [...prev, message].slice(-1000)); // Keep last 1000 logs
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  if (!networkState) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-gray-900">
          XXXLN Network Simulator
        </h1>
        
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
        
        <Card>
          <CardHeader>
            <CardTitle>Network Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-96 bg-gray-900 rounded-lg p-4 overflow-y-auto">
              {logs.map((log, i) => (
                <LogEntry key={i} message={log} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BlockchainDashboard;
