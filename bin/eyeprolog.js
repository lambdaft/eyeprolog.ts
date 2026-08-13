#!/usr/bin/env node
import { main } from '../dist/src/cli.js';

await main(process.argv.slice(2)).catch((error) => {
  console.error(`eyeprolog: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});
