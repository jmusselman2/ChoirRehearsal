// `node --test tests` resolves the directory to this file, which loads every *.test.js beside it.
// (`node --test` with no arguments finds the *.test.js files directly.)
import { readdirSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort()) {
  await import(new URL(name, dir));
}
