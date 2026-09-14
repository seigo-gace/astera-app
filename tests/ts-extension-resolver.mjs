import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.')) return nextResolve(specifier);
  const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
  for (const ext of EXTENSIONS) {
    const candidate = path.resolve(parent, `${specifier}${ext}`);
    if (fs.existsSync(candidate)) {
      return {
        url: pathToFileURL(candidate).href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier);
}
