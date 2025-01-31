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
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log('Dashboard client connected');
    socket.on('disconnect', () => {
      console.log('Dashboard client disconnected');
    });
  });

  return {
    start: async () => {
      return new Promise((resolve) => {
        httpServer.listen(port, () => {
          console.log(`Dashboard server listening on port ${port}`);
          resolve();
        });
      });
    },

    close: async () => {
      return new Promise((resolve) => {
        io.close(() => {
          httpServer.close(() => {
            console.log('Dashboard server closed');
            resolve();
          });
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