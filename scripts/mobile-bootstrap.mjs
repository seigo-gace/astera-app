import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const supportedPlatforms = new Set(['android', 'ios']);
const rawArguments = process.argv.slice(2);
const invalidPlatforms = rawArguments.filter((value) => !supportedPlatforms.has(value));
if (invalidPlatforms.length > 0) {
  throw new Error(`Unsupported platform: ${invalidPlatforms.join(', ')}. Use android and/or ios.`);
}

const platforms = rawArguments.length > 0 ? [...new Set(rawArguments)] : ['android', 'ios'];

function run(command, args) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

run('npm', ['run', 'build']);
run('npm', ['run', 'mobile:audit']);

for (const platform of platforms) {
  if (!existsSync(platform)) run('npx', ['cap', 'add', platform]);
  run('npx', ['cap', 'sync', platform]);
}

run('node', ['scripts/configure-native-platforms.mjs']);
run('npm', ['run', 'mobile:audit', '--', '--native', ...platforms]);

console.log(`Astera native platforms are ready: ${platforms.join(', ')}`);
