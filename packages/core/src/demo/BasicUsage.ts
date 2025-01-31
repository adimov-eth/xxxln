import { Either, right, left, chain, map, isLeft, fold } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { Map } from 'immutable';
import { createServerState, ServerMachineImpl } from '../machines/ServerMachine';
import { CentralEventBus } from '../eventbus/EventBus';
import { MachineRunner } from '../eventbus/MachineRunner';
import { SignerMachineImpl } from '../machines/SignerMachine';
import { EntityMachine, EntityConfig, EntityState } from '../types/MachineTypes';
import { createEntityForSigner, attachEntityToServer, connectSignerToEntity, registerEntityOnEventBus } from '../state/HierarchyManager';
import { MachineError, createMachineError, MachineEvent } from '../types/Core';
import { KeyStorage } from '../crypto/KeyStorage';
import { ActorMachine, BaseMachine } from '../eventbus/BaseMachine';
import { TaskEither, tryCatch } from 'fp-ts/TaskEither';
import { chain as TEchain } from 'fp-ts/TaskEither';

/**
 * Minimal stub for an EntityMachine implementation.
 */
class EntityMachineImpl extends ActorMachine implements EntityMachine, BaseMachine {
  public readonly type = 'ENTITY' as const;
  public readonly parentId: string;
  private _state: EntityState;
  private _version: number = 1;
  public readonly inbox: MachineEvent[] = [];

  constructor(
    public readonly id: string,
    parentId: string,
    public eventBus: CentralEventBus,
    private config: EntityConfig
  ) {
    super(id, eventBus);
    this.parentId = parentId;

    // Initialize with required EntityState structure
    this._state = Map<string, {
      readonly config: EntityConfig;
      readonly channels: Map<string, string>;
      readonly balance: bigint;
      readonly nonce: number;
    }>().set(this.id, {
      config: this.config,
      channels: Map<string, string>(),
      balance: BigInt(0),
      nonce: 0
    });
  }

  get state(): EntityState {
    return this._state;
  }

  get version() {
    return this._version;
  }

  async handleEvent(event: MachineEvent): Promise<Either<MachineError, void>> {
    // For demonstration, do nothing special
    return Promise.resolve(right(undefined));
  }
}

/**
 * Creates a new signer machine with the given ID
 */
const createSigner = (
  signerId: string,
  eventBus: CentralEventBus,
  serverId: string
): TaskEither<MachineError, SignerMachineImpl> =>
  tryCatch(
    async () => new SignerMachineImpl(signerId, eventBus, serverId),
    error => createMachineError('INTERNAL_ERROR', 'Failed to create signer', error)
  );

/**
 * Creates an entity configuration with a single signer
 */
const createInitialEntityConfig = (
  signerPublicKey: string
): EntityConfig => ({
  threshold: 1,
  signers: Map<string, number>().set(signerPublicKey, 1)
});

/**
 * Creates and starts a machine runner
 */
const startMachineRunner = (
  machine: BaseMachine,
  config: { pollInterval: number; maxEventsPerTick: number }
): TaskEither<MachineError, void> =>
  tryCatch(
    async () => {
      const runner = new MachineRunner(machine, config);
      await runner.start();
    },
    error => createMachineError('INTERNAL_ERROR', 'Failed to start machine runner', error)
  );

/**
 * Main demo function demonstrating the hierarchy setup flow
 */
export const demoHierarchyUsage = async (): Promise<Either<MachineError, void>> => {
  try {
    // Initialize key storage with a JavaScript Map (not Immutable.Map)
    await KeyStorage.initialize(new globalThis.Map<string, string>());

    // Create event bus
    const mainEventBus = new CentralEventBus();

    // Create and setup server
    const serverMachine = new ServerMachineImpl('server1', mainEventBus, createServerState());

    // Start server runner
    const runnerResult = await startMachineRunner(serverMachine, { 
      pollInterval: 100, 
      maxEventsPerTick: 10 
    })();
    if (isLeft(runnerResult)) return runnerResult;

    // Create first signer
    const signerResult = await createSigner('signerA', mainEventBus, 'server1')();
    if (isLeft(signerResult)) return signerResult;

    // Create entity
    const entityResult = createEntityForSigner(
      signerResult.right,
      createInitialEntityConfig('dummyPublicKeyForSignerA'),
      (entityId: string, parentId: string, config: EntityConfig) => 
        right(new EntityMachineImpl(entityId, parentId, mainEventBus, config))
    );
    if (isLeft(entityResult)) return entityResult;

    // Attach entity to server
    const attachResult = attachEntityToServer(serverMachine, entityResult.right);
    if (isLeft(attachResult)) return attachResult;

    // Create second signer
    const otherSignerResult = await createSigner('signerB', mainEventBus, 'server1')();
    if (isLeft(otherSignerResult)) return otherSignerResult;

    // Connect second signer to entity
    const connectResult = connectSignerToEntity(entityResult.right, otherSignerResult.right, 1);
    if (isLeft(connectResult)) return connectResult;

    // Register entity on event bus
    const registerResult = registerEntityOnEventBus(mainEventBus, connectResult.right);
    if (isLeft(registerResult)) return registerResult;

    // Start entity runner
    const entityRunnerResult = await startMachineRunner(
      connectResult.right as EntityMachineImpl,
      {
        pollInterval: 100,
        maxEventsPerTick: 10
      }
    )();
    if (isLeft(entityRunnerResult)) return entityRunnerResult;

    console.log('Demo complete. We have serverMachine + 2 signers + 1 entity attached successfully!');
    return right(undefined);
  } catch (error) {
    return left(createMachineError('INTERNAL_ERROR', 'Demo failed with unexpected error', error));
  }
};

// Run if invoked directly
if (require.main === module) {
  demoHierarchyUsage().catch(err => {
    console.error('Unhandled error in demo:', err);
    process.exit(1);
  });
} 