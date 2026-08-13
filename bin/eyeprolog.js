#!/usr/bin/env -S npx tsx
import { main } from '../src/cli.ts';

await main(process.argv.slice(2)).catch((error) => {
  console.error(`eyeprolog: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});
