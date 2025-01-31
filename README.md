# XXXLN Network

A scalable, decentralized payment network built with TypeScript using functional programming principles.

## Features

- Decentralized network architecture
- Off-chain payment channels with multi-signature security
- Event-driven communication
- Functional programming style with immutable data structures
- Strong type safety with TypeScript
- Actor-based architecture with hierarchical state management

## Project Structure

```
packages/
  ├── core/           # Core network functionality
  ├── simulator/      # Network simulation and testing
  └── dashboard/      # Network monitoring interface
```

## Recent Changes

- Migrated to core Transaction type throughout the codebase
- Renamed `runSimpleBlockProductionLoop` to `runBlockProductionLoop`
- Improved type safety in transaction handling
- Standardized functional programming patterns

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Start simulator
pnpm dev
```

## Architecture

- Functional core with immutable data structures
- Event-driven communication between nodes
- Type-safe message passing using discriminated unions
- Hierarchical state management
- Off-chain payment channels with multi-signature security

## Technologies

- TypeScript
- fp-ts for functional programming
- io-ts for runtime type validation
- immutable.js for immutable data structures
- Bun runtime
- pnpm for package management

## License

MIT