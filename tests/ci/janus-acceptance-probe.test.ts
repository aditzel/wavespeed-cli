import { it } from "bun:test";

it("temporary Janus cancellation probe; never merge", async () => {
  if (process.env.HOME?.includes("wavespeed-janus-")) {
    console.log("Janus cancellation probe is ready");
    await Bun.sleep(120_000);
  }
}, 150_000);
