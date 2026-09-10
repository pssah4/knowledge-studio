#!/usr/bin/env node
// Source checkout entry; preserve the query skill's read-only boundary.
process.argv.push('--read-only');
await import('../../../runtime/node-cli.mjs');
