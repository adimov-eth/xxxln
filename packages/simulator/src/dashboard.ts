import { Server } from 'socket.io';
import { createServer } from 'http';
import { DashboardUpdate } from './types';

export interface DashboardServer {
  readonly start: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly broadcastNetworkState: (update: DashboardUpdate) => void;
  readonly broadcastLog: (message: string) => void;
}

export const createDashboardServer = (port: number): DashboardServer => {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: "http://localhost:5173", // Vite's default port
      methods: ["GET", "POST"]
    }
  });

  return {
    start: async () => {
      return new Promise((resolve) => {
        httpServer.listen(port, () => {
          resolve();
        });
      });
    },

    close: async () => {
      return new Promise((resolve) => {
        io.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },

    broadcastNetworkState: (update: DashboardUpdate) => {
      io.emit('networkState', update);
    },

    broadcastLog: (message: string) => {
      io.emit('log', message);
    }
  };
}; 