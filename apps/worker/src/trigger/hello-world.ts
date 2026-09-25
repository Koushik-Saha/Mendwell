import { logger, task } from "@trigger.dev/sdk";

export type HelloWorldPayload = { name?: string };

export function greet(payload: HelloWorldPayload): string {
  const name = payload.name?.trim();
  return `Hello, ${name ? name : "world"}!`;
}

export const helloWorld = task({
  id: "hello-world",
  run: async (payload: HelloWorldPayload) => {
    // Hard rule 8: log step names and IDs, never payload content.
    logger.info("hello-world.start");
    return { message: greet(payload) };
  },
});
