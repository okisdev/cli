import { collect } from '@/src/commands/ai/usage/collect';
import { Command } from 'commander';

export const usage = new Command().name('usage').description('collect and publish AI tool usage').addCommand(collect);
