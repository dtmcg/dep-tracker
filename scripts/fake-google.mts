// Stand-in for Google's OAuth and Sheets endpoints, for the end-to-end tests.
import { startFakeGoogle } from "../packages/adapter-gsheets/src/fake-google.ts";

const port = Number(process.env.PORT ?? 4319);
const fake = await startFakeGoogle({
  clientId: process.env.GOOGLE_CLIENT_ID ?? "e2e-client",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "e2e-secret",
  port,
});
console.log(`fake Google at ${fake.url}`);
