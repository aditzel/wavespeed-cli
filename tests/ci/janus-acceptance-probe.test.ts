import { it } from "bun:test";

it("temporary Janus dependency failure probe; never merge", () => {
  throw new Error("Intentional test failure to verify downstream validation is blocked");
});
