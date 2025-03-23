import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import inquirer from 'inquirer';

const TEMPLATES = {
  'nextjs + better-auth + pg + trpc': 'nextjs-better-auth-pg-trpc',
  'nextjs + authjs + pg + trpc': 'nextjs-authjs-pg-trpc',
} as const;

export const create = new Command('create')
  .description('Create a new project with predefined templates')
  .argument('[project-name]', 'Name of the project to create')
  .action(async (projectName?: string) => {
    const { template } = await inquirer.prompt([
      {
        type: 'list',
        name: 'template',
        message: 'What do you want to create?',
        choices: Object.keys(TEMPLATES),
      },
    ]);

    const templatePath = TEMPLATES[template as keyof typeof TEMPLATES];
    const targetDir = projectName || templatePath;

    if (existsSync(targetDir)) {
      console.error(`Error: Directory "${targetDir}" already exists`);
      process.exit(1);
    }

    try {
      console.log(`Cloning template ${template}...`);
      execSync(`git clone https://github.com/okisdev/templates.git ${targetDir}`, { stdio: 'inherit' });

      // Move into the cloned directory
      process.chdir(targetDir);

      // Remove the .git directory to start fresh
      execSync('rm -rf .git', { stdio: 'inherit' });

      // Initialize a new git repository
      execSync('git init', { stdio: 'inherit' });

      console.log('\n✨ Project created successfully!');
      console.log('\nNext steps:');
      console.log(`1. cd ${targetDir}`);
      console.log('2. npm install');
      console.log('3. npm run dev');
    } catch (error) {
      console.error('Error creating project:', error);
      process.exit(1);
    }
  });
