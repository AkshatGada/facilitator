import { InMemoryUptoSessionStore } from "./store.js";
import { createUptoSweeper } from "./sweeper.js";
import { localFacilitatorClient } from "../client.js";

export const uptoStore = new InMemoryUptoSessionStore();

export const uptoSweeper = createUptoSweeper({
  store: uptoStore,
  facilitatorClient: localFacilitatorClient,
});
