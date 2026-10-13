import { usage } from '@/src/commands/ai/usage';
import { Command } from 'commander';

export const ai = new Command().name('ai').enablePositionalOptions().description('AI usage tooling').addCommand(usage);
