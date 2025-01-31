# Development Setup

This guide will help you set up your development environment to contribute to the Extended Payment Network project.

## Prerequisites

- Node.js 18+ (LTS recommended)
- pnpm 8+ (`npm install -g pnpm`)
- Git
- TypeScript knowledge
- VS Code (recommended) or another TypeScript-capable IDE

## Environment Setup

1. **Clone the Repository**
```bash
git clone https://github.com/yourusername/xxxln
cd xxxln
```

2. **Install Dependencies**
```bash
pnpm install
```

3. **Build the Project**
```bash
pnpm build
```

4. **Run Tests**
```bash
pnpm test
```

## IDE Configuration

### VS Code Setup

1. Install recommended extensions:
   - ESLint
   - Prettier
   - TypeScript and JavaScript Language Features
   - Error Lens

2. Configure settings.json:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

### Project Structure

```
packages/
  ├── core/           # Core network functionality
  │   ├── src/        # Source code
  │   ├── tests/      # Unit tests
  │   └── package.json
  │
  ├── simulator/      # Network simulation
  │   ├── src/
  │   └── package.json
  │
  └── dashboard/      # Monitoring interface
      ├── src/
      └── package.json
```

## Development Workflow

1. **Create a Feature Branch**
```bash
git checkout -b feature/your-feature-name
```

2. **Run Development Server**
```bash
# For core package development
cd packages/core
pnpm dev

# For simulator
cd packages/simulator
pnpm dev

# For dashboard
cd packages/dashboard
pnpm dev
```

3. **Type Checking**
```bash
pnpm typecheck
```

4. **Linting**
```bash
pnpm lint
```

5. **Testing**
```bash
# Run all tests
pnpm test

# Run specific package tests
cd packages/core
pnpm test

# Run with coverage
pnpm test --coverage
```

## Environment Variables

Create a `.env` file in the root directory:

```env
# Network Configuration
NODE_NETWORK_TIMEOUT=10000
MAX_TRANSACTIONS_PER_BLOCK=100
BLOCK_PRODUCTION_INTERVAL=5000

# Test Keys (Development Only)
VALIDATOR1_KEY=test_key_1
VALIDATOR2_KEY=test_key_2
VALIDATOR3_KEY=test_key_3

# Dashboard Configuration
VITE_WS_URL=ws://localhost:3100
```

## Debugging

### VS Code Debug Configuration

Add this to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${file}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Simulator",
      "program": "${workspaceFolder}/packages/simulator/src/runNodes.ts",
      "preLaunchTask": "tsc: build - packages/simulator/tsconfig.json",
      "outFiles": ["${workspaceFolder}/packages/simulator/dist/**/*.js"]
    }
  ]
}
```

### Logging

Use the built-in logger with appropriate levels:

```typescript
import { createLogger } from '@xxxln/core';

const logger = createLogger('YOUR_MODULE');

logger.debug('Detailed information');
logger.info('General information');
logger.warn('Warning messages');
logger.error('Error messages');
```

## Common Issues

1. **Build Errors**
   - Run `pnpm clean` and rebuild
   - Check TypeScript version matches
   - Verify all dependencies are installed

2. **Test Failures**
   - Run tests in isolation
   - Check for environment dependencies
   - Verify test data setup

3. **Type Errors**
   - Update type definitions
   - Check import paths
   - Verify generic constraints

## Next Steps

- Read the [Coding Guidelines](./guidelines.md)
- Learn about [Testing](./testing.md)
- Review [Documentation](./documentation.md) practices

## Getting Help

- Check existing [GitHub Issues](https://github.com/yourusername/xxxln/issues)
- Join our [Discord](https://discord.gg/xxxln)
- Review the [FAQ](../faq.md) 