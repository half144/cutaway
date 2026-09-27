#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { autoUpdate } from '../../../src/cli/auto-update.mjs';

autoUpdate(fileURLToPath(new URL('../../../', import.meta.url)));
await import('../../../src/cli.mjs');
