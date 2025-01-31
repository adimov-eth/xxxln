# Extended Layer Network (XLN)

A high-performance, decentralized payment network built with functional programming principles and actor-based architecture.

## What is XLN?

XLN is a next-generation payment network that combines:

- **Off-chain Scalability**: Payment channels and state channels for instant transactions
- **Strong Security**: Multi-signature capabilities and formal verification
- **Type Safety**: Built with TypeScript and functional programming principles
- **Actor-Based Design**: Isolated state management and message-passing architecture

The network achieves high throughput by moving most transactions off-chain while maintaining security through cryptographic proofs and an actor-based consensus mechanism.

## Key Features

### 1. Payment Channels
- Instant off-chain transactions
- Bi-directional state updates
- Dispute resolution system
- Automatic settlement

### 2. Multi-Signature Entities
- Configurable signature thresholds
- Weighted voting systems
- Proposal-based governance
- Hierarchical account structure

### 3. Actor-Based Architecture
- Isolated state management
- Type-safe message passing
- Event-driven communication
- Formal verification ready

### 4. Functional Core
- Immutable data structures
- Pure functions
- Type-driven development
- Compositional design

## Technical Stack

- **Language**: TypeScript with strict type checking
- **Runtime**: Bun for high performance
- **Architecture**: Actor model with hierarchical state
- **Packages**:
  - `@xxxln/core`: Core protocol implementation
  - `@xxxln/simulator`: Network simulation tools
  - `@xxxln/dashboard`: Monitoring interface

## Quick Start

```bash
# Install dependencies
pnpm install

# Start a local network
pnpm dev

# Open dashboard
open http://localhost:5173
```

See our [Getting Started Guide](docs/tutorials/local-network.md) for detailed setup instructions.

## Documentation

- [Architecture Overview](docs/architecture/overview.md)
- [Implementation Details](docs/implementation/state-management.md)
- [API Reference](docs/api/index.md)
- [Tutorials](docs/tutorials/local-network.md)

## Use Cases

### 1. Payment Networks
- High-frequency trading settlements
- Micro-payment systems
- Cross-border transactions
- Payment channel networks

### 2. State Channels
- Gaming networks
- Real-time auctions
- Streaming payments
- Service marketplaces

### 3. Multi-Sig Applications
- DAO treasury management
- Corporate accounts
- Escrow services
- Joint accounts

## Project Status

XLN is currently in **Alpha** stage:
- Core protocol implementation ✅
- Basic networking layer ✅
- Payment channels ✅
- Multi-sig entities ✅
- Production hardening 🚧
- Security audits 🚧

## Contributing

We welcome contributions! See our [Contributing Guide](docs/contributing/setup.md) to get started.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contact

- GitHub Issues: [Report a bug](https://github.com/yourusername/xxxln/issues)
- Discord: [Join our community](https://discord.gg/xxxln)
- Twitter: [@xxxln_network](https://twitter.com/xxxln_network)


# Extended Payment Network Documentation

Welcome to the Extended Payment Network documentation. This documentation provides comprehensive information about our scalable, decentralized payment system built on an actor-based architecture.

## Architecture Highlights

### Layered Architecture
The system is organized into distinct layers:
- **Core**: Fundamental building blocks, state management, and cryptographic primitives
- **Network**: P2P communication, consensus, and block propagation
- **Simulator**: Testing and simulation infrastructure
- **Dashboard**: Real-time monitoring and visualization

### Actor-Based Design
- Each component (Server, Signer, Entity, Channel) is an independent actor
- Message-based communication with typed events
- Isolated state management per actor
- Non-blocking, asynchronous operations

### Functional Programming Principles
- Immutable data structures using `immutable.js`
- Pure functions and side-effect isolation
- Type-driven design with TypeScript
- Composition over inheritance
- Error handling with `Either` type

For deeper dives into the architecture, see:
- [Architecture Overview](./architecture/overview.md)
- [Components](./architecture/components.md)
- [Network Protocols](./architecture/protocols.md)

## Documentation Structure

Our documentation is organized into four main sections:

### 1. Architecture
Learn about the system's core design, components, and protocols:
- [System Overview](architecture/overview.md)
- [Core Components](architecture/components.md)
- [Network Protocols](architecture/protocols.md)
- [Network Architecture](architecture/networking.md)

### 2. Implementation
Understand the implementation details:
- [State Management](implementation/state-management.md)
- [Entity System](implementation/entities.md)
- [Payment Channels](implementation/channels.md)

### 3. Technical Details
Dive deep into technical specifications:
- [Merkle Trees](technical/merkle.md)
- [Consensus Mechanism](technical/consensus.md)
- [Storage System](technical/storage.md)

### 4. Tutorials
Step-by-step guides to get started:
- [Starting a Local Network](tutorials/local-network.md)
- [Creating Signers and Entities](tutorials/signer-entity.md)
- [Working with Channels](tutorials/channels.md)

## Getting Started

1. Start with the [Architecture Overview](architecture/overview.md) to understand the system's design
2. Follow the [Local Network Tutorial](tutorials/local-network.md) to run your first node
3. Explore [Core Components](architecture/components.md) to learn about system elements
4. Dive into [Implementation](implementation/state-management.md) for practical details

## Contributing

We welcome contributions to improve this documentation. Please see our [GitHub repository](https://github.com/yourusername/xxxln) for contribution guidelines.

## License

This documentation is licensed under the MIT License. See the LICENSE file for details. 