import { Context, Layer } from "effect";

import { ActorStore } from "./actor-store";
import { chunkMachine } from "./machines/chunk";
import { jobMachine } from "./machines/job";
import { libraryMachine } from "./machines/library";
import { videoMachine } from "./machines/video";

export interface ActorManagerShape {
	readonly chunks: ActorStore<typeof chunkMachine>;
	readonly jobs: ActorStore<typeof jobMachine>;
	readonly libraries: ActorStore<typeof libraryMachine>;
	readonly videos: ActorStore<typeof videoMachine>;
}

export class ActorManagerService extends Context.Tag("ActorManagerService")<
	ActorManagerService,
	ActorManagerShape
>() {}

export const ActorManagerServiceLive = Layer.sync(ActorManagerService, () => ({
	jobs: new ActorStore(jobMachine),
	videos: new ActorStore(videoMachine),
	libraries: new ActorStore(libraryMachine),
	chunks: new ActorStore(chunkMachine),
}));
