import { right, isLeft } from 'fp-ts/Either';
import { createServerState, ServerMachineImpl } from '../machines/ServerMachine';
import { CentralEventBus } from '../eventbus/EventBus';
import { MachineRunner } from '../eventbus/MachineRunner';
import { SignerMachineImpl } from '../machines/SignerMachine'; 
import { EntityMachine } from '../types/MachineTypes';
import { createEntityForSigner, attachEntityToServer, connectSignerToEntity, registerEntityOnEventBus } from '../state/HierarchyManager';
import { Map } from 'immutable';
import { ActorMachine } from '../eventbus/BaseMachine';
import { createMachineError } from '../types/Core';

/**
 * Minimal stub for an EntityMachine implementation.
 * In practice, you'd have a real EntityMachineImpl with
 * real logic in handleEvent, etc.
 */
class EntityMachineImpl extends ActorMachine implements EntityMachine {
  public readonly type = 'ENTITY' as const;
  public readonly parentId: string;
  private _state;
  private _version: number = 1;

  constructor(
    public readonly id: string,
    parentId: string,
    public eventBus: CentralEventBus,
    private config: {
      // Attempting to keep it in line with the typical "EntityConfig"
      threshold: number;
      signers: Map<string, number>;
    }
  ) {
    super(id, eventBus);
    this.parentId = parentId;

    // Store minimal data inside the Immutable state. 
    // Typically you'd store more fields (channels, balance, etc.).
    this._state = Map<string, unknown>().set(this.id, {
      config: {
        threshold: this.config.threshold,
        signers: this.config.signers,
      }
    });
  }

  get state() {
    return this._state;
  }

  get version() {
    return this._version;
  }

  async handleEvent(event) {
    // For demonstration, do nothing special
    return right(undefined);
  }
}

/**
 * Helper: create an EntityMachine instance (our 'factory').
 */
function entityMachineFactory(
  id: string,
  parentId: string,
  config: {
    threshold: number;
    signers: Map<string, number>;
  }
): EntityMachine {
  // In real usage, we might do error checks or eventually return an Either.
  const eventBus = new CentralEventBus(); // you might use a shared bus instead
  return new EntityMachineImpl(id, parentId, eventBus, config);
}

/**
 * Demo usage function
 */
export async function demoHierarchyUsage() {
  // 1) Create an EventBus for global usage
  const mainEventBus = new CentralEventBus();

  // 2) Create a server machine
  const serverState = createServerState();
  const serverMachine = new ServerMachineImpl('server1', mainEventBus, serverState);

  // 3) Spin up a machine runner for the server
  const serverRunner = new MachineRunner(serverMachine, { pollInterval: 100, maxEventsPerTick: 10 });
  await serverRunner.start();

  // 4) Create a primary signer
  const signerId = 'signerA'; // This ID would typically be some unique or hashed value
  const signerMachine = new SignerMachineImpl(signerId, mainEventBus, 'server1');

  // 5) We want to create an entity from this signer
  //    Let's set a threshold=1 and an initial single-signer in the config
  const entityResult = createEntityForSigner(
    signerMachine,
    {
      threshold: 1,
      signers: Map<string, number>().set('dummyPublicKeyForSignerA', 1), 
    },
    (entityId, parentId, config) => {
      // Use our "factory" logic to build an EntityMachine
      const machine = entityMachineFactory(entityId, parentId, config);
      return right(machine);
    }
  );

  if (isLeft(entityResult)) {
    console.error('Failed to create entity:', entityResult.left);
    return;
  }
  const entityMachine = entityResult.right;

  // 6) Attach entity machine to the server
  //    (This typically just updates the server's submachines state.)
  const attachResult = attachEntityToServer(serverMachine, entityMachine);
  if (isLeft(attachResult)) {
    console.error('Failed to attach entity to server:', attachResult.left);
    return;
  }

  // 7) Now suppose we want to add a second signer to that entity
  const otherSignerId = 'signerB';
  const otherSignerMachine = new SignerMachineImpl(otherSignerId, mainEventBus, 'server1');
  
  // We give it a weight of 1
  const connectResult = connectSignerToEntity(entityMachine, otherSignerMachine, 1);
  if (isLeft(connectResult)) {
    console.error('Failed to connect signer to entity:', connectResult.left);
    return;
  }
  const updatedEntity = connectResult.right;

  // 8) Register the new entity on the main event bus. If it needs to receive events, you do so here:
  const registerResult = registerEntityOnEventBus(mainEventBus, updatedEntity);
  if (isLeft(registerResult)) {
    console.error('Failed to register entity on event bus:', registerResult.left);
    return;
  }

  // 9) Spin up a runner for the entity machine so it can handle events from the bus
  const entityRunner = new MachineRunner(updatedEntity, { pollInterval: 100, maxEventsPerTick: 10 });
  await entityRunner.start();

  console.log('Demo complete. We have serverMachine + 2 signers + 1 entity attached successfully!');
}

// Run if invoked directly (for demo)
if (require.main === module) {
  demoHierarchyUsage().catch(err => {
    console.error('Unhandled error in demo:', err);
  });
} 