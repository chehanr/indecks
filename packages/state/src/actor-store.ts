import {
	type AnyStateMachine,
	createActor,
	type EventFromLogic,
	type SnapshotFrom,
} from "xstate";

type ActorInstance<T extends AnyStateMachine> = ReturnType<
	typeof createActor<T>
>;

/**
 * Manages long-lived XState actors with persistence support.
 *
 * Actors are created/restored and kept in memory. After sending events,
 * callers retrieve the persisted snapshot to sync back to the database.
 */
export class ActorStore<TMachine extends AnyStateMachine> {
	private readonly machine: TMachine;
	private readonly actors = new Map<string, ActorInstance<TMachine>>();

	constructor(machine: TMachine) {
		this.machine = machine;
	}

	/** Create a new actor with the machine's initial state. */
	create(id: string): ActorInstance<TMachine> {
		const existing = this.actors.get(id);
		if (existing) {
			return existing;
		}

		const actor = createActor(this.machine);
		actor.start();
		this.actors.set(id, actor);
		return actor;
	}

	/** Restore an actor from a persisted snapshot (e.g. from DB). */
	restore(
		id: string,
		snapshot: SnapshotFrom<TMachine>
	): ActorInstance<TMachine> {
		this.dispose(id);
		const actor = createActor(this.machine, {
			snapshot,
		} as never);
		actor.start();
		this.actors.set(id, actor);
		return actor;
	}

	/** Get the actor instance by ID. */
	get(id: string): ActorInstance<TMachine> | undefined {
		return this.actors.get(id);
	}

	/** Send an event to an actor. Returns the persisted snapshot, or null if not found. */
	send(
		id: string,
		event: EventFromLogic<TMachine>
	): SnapshotFrom<TMachine> | null {
		const actor = this.actors.get(id);
		if (!actor) {
			return null;
		}
		actor.send(event);
		return actor.getPersistedSnapshot() as SnapshotFrom<TMachine>;
	}

	/** Check if an event would cause a state transition (uses XState's .can()). */
	can(id: string, event: EventFromLogic<TMachine>): boolean {
		const actor = this.actors.get(id);
		if (!actor) {
			return false;
		}
		return (actor.getSnapshot() as { can: (e: unknown) => boolean }).can(event);
	}

	/** Get the current persisted snapshot for DB storage. */
	getPersistedSnapshot(id: string): SnapshotFrom<TMachine> | null {
		const actor = this.actors.get(id);
		if (!actor) {
			return null;
		}
		return actor.getPersistedSnapshot() as SnapshotFrom<TMachine>;
	}

	/** Get the current state value (e.g. "pending", "running"). */
	getState(id: string): string | null {
		const actor = this.actors.get(id);
		if (!actor) {
			return null;
		}
		return (actor.getSnapshot() as { value: string }).value;
	}

	/** Stop and remove an actor. Safe to call multiple times. */
	dispose(id: string): void {
		const actor = this.actors.get(id);
		if (actor) {
			actor.stop();
			this.actors.delete(id);
		}
	}

	/** Stop and remove all actors. */
	disposeAll(): void {
		for (const actor of this.actors.values()) {
			actor.stop();
		}
		this.actors.clear();
	}
}
