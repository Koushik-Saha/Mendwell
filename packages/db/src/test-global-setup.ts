import { prepareTestDbSnapshot } from "./testing";

/** Vitest globalSetup (db, web, worker): one migrated PGlite snapshot for the whole run. */
export default async function setup() {
  await prepareTestDbSnapshot();
}
