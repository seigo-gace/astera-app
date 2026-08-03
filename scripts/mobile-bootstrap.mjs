import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const supportedPlatforms = new Set(['android', 'ios']);
const requestedPlatforms = process.argv.slice(2).filter((value) => supportedPlatforms.has(value));
const platforms = requestedPlatforms.length > 0 ? requestedPlatforms : ['android', 'ios'];

function run(command, args) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

run('npm', ['run', 'build']);

for (const platform of platforms) {
  if (!existsSync(platform)) {
    run('npx', ['cap', 'add', platform]);
  }

  run('npx', ['cap', 'sync', platform]);
}

console.log(`Astera native platforms are ready: ${platforms.join(', ')}`);
