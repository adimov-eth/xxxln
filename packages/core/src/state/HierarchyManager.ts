import { Either, left, right } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { MachineError, createMachineError, MachineId, Hash } from '../types/Core';
import { EntityMachine, EntityConfig, EntityState, EntityStateData } from '../types/MachineTypes';
import { ServerMachine } from '../types/MachineTypes';
import { SignerMachine } from '../types/MachineTypes';
import { Map } from 'immutable';
import { createHash } from 'crypto';
import { CentralEventBus } from '../eventbus/EventBus';
import { ActorMachine, BaseMachine } from '../eventbus/BaseMachine';

/**
 * Create a new EntityMachine for a given signer machine.
 * In real usage, you'd have an EntityMachineImpl like you have
 * for ChannelMachine, SignerMachine, etc. For illustration, we
 * demonstrate a simple no-op "placeholder" creation below.
 */
export function createEntityForSigner(
  signer: SignerMachine,
  config: EntityConfig,
  entityMachineFactory: (id: MachineId, parentId: MachineId, config: EntityConfig) => Either<MachineError, EntityMachine>
): Either<MachineError, EntityMachine> {
  // Generate a deterministic entity ID based on signer and config
  const entityId = createHash('sha256')
    .update(`${signer.id}_${JSON.stringify(config)}_${Date.now()}`)
    .digest('hex')
    .slice(0, 16);

  return entityMachineFactory(entityId, signer.id, config);
}

/**
 * Connect (attach) an entity machine to a server's submachines list.
 * Updates the server's state so it knows about this entity submachine.
 */
export function attachEntityToServer(
  server: ServerMachine,
  entity: EntityMachine
): Either<MachineError, ServerMachine> {
  try {
    const serverData = server.state.get('data') as { submachines: Map<string, Hash> };
    if (!serverData) {
      return left(createMachineError('INVALID_STATE', 'Server state data is missing'));
    }

    // Compute entity's state root
    const entityStateRoot = createHash('sha256')
      .update(JSON.stringify(entity.state))
      .digest('hex');

    // Update server's submachines map with entity's state root
    const updatedSubmachines = serverData.submachines.set(entity.id, entityStateRoot);

    const updatedData = {
      ...serverData,
      submachines: updatedSubmachines
    };

    const newServerState = server.state.set('data', updatedData);

    const updatedServer: ServerMachine = {
      ...server,
      state: newServerState,
      version: server.version + 1
    };

    return right(updatedServer);
  } catch (error) {
    return left(createMachineError('INTERNAL_ERROR', 'Failed to attach entity to server', error));
  }
}

/**
 * Demonstrates associating a signer with an existing Entity configuration.
 * Potentially you'd add or update signers inside the entity's config so it
 * recognizes them as controllers. This sample sets the config's signers field.
 */
export function connectSignerToEntity(
  entity: EntityMachine,
  newSigner: SignerMachine,
  weight: number
): Either<MachineError, EntityMachine> {
  try {
    const entityData = entity.state.get(entity.id) as EntityStateData;
    if (!entityData) {
      return left(createMachineError('INVALID_STATE', 'Entity data not found'));
    }

    // Get signer's public key
    const signerData = newSigner.state.get('data') as { publicKey: string };
    if (!signerData?.publicKey) {
      return left(createMachineError('INVALID_STATE', 'Signer public key not found'));
    }

    // Update signers map
    const updatedSigners = entityData.config.signers.set(signerData.publicKey, weight);

    // Create new entity data with updated config
    const newEntityData: EntityStateData = {
      ...entityData,
      config: {
        ...entityData.config,
        signers: updatedSigners
      },
      blockHeight: entityData.blockHeight,
      latestHash: entityData.latestHash,
      stateRoot: createHash('sha256')
        .update(JSON.stringify(entityData))
        .digest('hex'),
      nonce: entityData.nonce,
      proposals: entityData.proposals || Map(),
      pendingTransactions: entityData.pendingTransactions || Map(),
      channels: entityData.channels || Map(),
      balance: entityData.balance || BigInt(0)
    };

    // Update entity state
    const newState = entity.state.set(entity.id, newEntityData);

    const updatedEntity: EntityMachine = {
      ...entity,
      state: newState,
      version: entity.version + 1
    };

    return right(updatedEntity);
  } catch (error) {
    return left(createMachineError('INTERNAL_ERROR', 'Failed to connect signer to entity', error));
  }
}

/**
 * Example of registering the new entity machine on the event bus so it
 * can begin receiving events. We supply a basic pattern that you can adapt.
 */
export function registerEntityOnEventBus(
  eventBus: CentralEventBus,
  entityMachine: BaseMachine
): Either<MachineError, void> {
  try {
    eventBus.registerMachine(entityMachine);
    return right(undefined);
  } catch (error) {
    return left(createMachineError('INTERNAL_ERROR', 'Failed to register entity on event bus', error));
  }
} 