import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
import { saveConfig, isInitialized, getDefaultConfig, ensureDirs, loadConfig } from '../core/config';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化 AI 内容处理项目')
    .option('-y, --yes', '使用默认配置快速初始化')
    .option('--force', '强制重新初始化，覆盖现有配置')
    .action(async (options) => {
      const cwd = process.cwd();
      const alreadyInitialized = isInitialized(cwd);

      if (alreadyInitialized && !options.force) {
        console.log(chalk.yellow('项目已经初始化过了。使用 --force 可以重新初始化。'));
        return;
      }

      if (options.yes) {
        const defaultConfig = getDefaultConfig();
        saveConfig(defaultConfig, cwd);
        ensureDirs(defaultConfig, cwd);
        console.log(chalk.green('✓ 项目初始化完成（使用默认配置）'));
        console.log(chalk.gray(`配置文件: .aict-config.json`));
        return;
      }

      console.log(chalk.bold.cyan('🚀 AI 内容处理 CLI - 项目初始化向导\n'));

      const defaultConfig = getDefaultConfig();
      const currentConfig = alreadyInitialized ? loadConfig(cwd) : defaultConfig;

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: '项目名称:',
          default: currentConfig.projectName,
        },
        {
          type: 'list',
          name: 'apiProvider',
          message: 'AI 服务提供商:',
          choices: [
            { name: 'OpenAI', value: 'openai' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'Mock (模拟，用于测试)', value: 'mock' },
          ],
          default: currentConfig.apiProvider,
        },
        {
          type: 'input',
          name: 'apiKey',
          message: 'API Key:',
          default: currentConfig.apiKey || '',
          when: (a: any) => a.apiProvider !== 'mock',
        },
        {
          type: 'input',
          name: 'baseUrl',
          message: 'API Base URL (可选):',
          default: currentConfig.baseUrl || '',
          when: (a: any) => a.apiProvider !== 'mock',
        },
        {
          type: 'input',
          name: 'defaultModel',
          message: '默认模型:',
          default: (a: any) => {
            if (a.apiProvider === 'openai') return 'gpt-3.5-turbo';
            if (a.apiProvider === 'anthropic') return 'claude-3-sonnet-20240229';
            return currentConfig.defaultModel;
          },
        },
        {
          type: 'input',
          name: 'outputDir',
          message: '输出目录:',
          default: currentConfig.outputDir,
        },
        {
          type: 'input',
          name: 'templatesDir',
          message: '模板目录:',
          default: currentConfig.templatesDir,
        },
        {
          type: 'list',
          name: 'defaultTone',
          message: '默认语气:',
          choices: [
            { name: '正式', value: 'formal' },
            { name: '轻松', value: 'casual' },
            { name: '专业', value: 'professional' },
            { name: '友好', value: 'friendly' },
          ],
          default: currentConfig.defaultTone,
        },
        {
          type: 'list',
          name: 'defaultSummaryLength',
          message: '默认摘要长度:',
          choices: [
            { name: '简短 (约100字)', value: 'short' },
            { name: '中等 (约200-300字)', value: 'medium' },
            { name: '详细 (约500字)', value: 'long' },
          ],
          default: currentConfig.defaultSummaryLength,
        },
        {
          type: 'number',
          name: 'maxRetries',
          message: '最大重试次数:',
          default: currentConfig.maxRetries,
        },
        {
          type: 'number',
          name: 'concurrency',
          message: '并发处理数量:',
          default: currentConfig.concurrency,
        },
      ]);

      const config = {
        ...currentConfig,
        ...answers,
      };

      saveConfig(config, cwd);
      ensureDirs(config, cwd);

      console.log('\n' + chalk.green('✓ 项目初始化完成！'));
      console.log(chalk.gray(`\n配置文件: .aict-config.json`));
      console.log(chalk.gray(`模板目录: ${config.templatesDir}/`));
      console.log(chalk.gray(`输出目录: ${config.outputDir}/`));
      console.log(chalk.gray(`历史记录: ${config.historyFile}`));
      console.log('\n' + chalk.cyan('下一步: '));
      console.log(chalk.gray('  使用 ') + chalk.white('aict prompt create') + chalk.gray(' 创建提示词模板'));
      console.log(chalk.gray('  使用 ') + chalk.white('aict run') + chalk.gray(' 运行单次任务'));
      console.log(chalk.gray('  使用 ') + chalk.white('aict batch') + chalk.gray(' 批量处理任务'));
    });
}
