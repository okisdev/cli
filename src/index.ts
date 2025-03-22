#!/usr/bin/env node

import { info } from '@/src/commands/info';
import { Command } from 'commander';

import packageJson from '../package.json';

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main() {
  const program = new Command()
    .name('okisdev')
    .description('okisdev cli')
    .version(packageJson.version || '1.0.0', '-v, --version', 'display the version number');

  program.addCommand(info);

  program.parse();
}

main();
