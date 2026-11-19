import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const tempOutput = name => join( tmpdir(), name );
