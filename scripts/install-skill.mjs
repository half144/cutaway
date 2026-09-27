import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../skills/cutaway', import.meta.url));
const destination = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills', 'cutaway');
await mkdir(dirname(destination), { recursive: true });
await symlink(source, destination, 'dir');
console.log(`Installed skill: ${destination}`);
