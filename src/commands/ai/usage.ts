import { collect } from '@/src/commands/ai/usage/collect';
import { cursor } from '@/src/commands/ai/usage/cursor';
import { grok } from '@/src/commands/ai/usage/grok';
import { omp } from '@/src/commands/ai/usage/omp';
import { proxy } from '@/src/commands/ai/usage/proxy';
import { watch } from '@/src/commands/ai/usage/watch';
import { Command } from 'commander';

export const usage = new Command().name('usage').enablePositionalOptions().description('collect and publish AI tool usage').addCommand(collect).addCommand(cursor).addCommand(grok).addCommand(omp).addCommand(proxy).addCommand(watch);
