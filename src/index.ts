#!/usr/bin/env node

import { Command } from 'commander';
const chalk = require('chalk');
import { registerInitCommand } from './commands/init';
import { registerPromptCommand } from './commands/prompt';
import { registerRunCommand } from './commands/run';
import { registerBatchCommand } from './commands/batch';
import { registerReviewCommand } from './commands/review';
import { registerHistoryCommand } from './commands/history';
import { registerExportCommand } from './commands/export';
import { isInitialized } from './core/config';

const program = new Command();

program
  .name('aict')
  .description('AI 内容处理 CLI 工具 - 批量处理文案、摘要和质检任务')
  .version('1.0.0')
  .usage('<command> [options]');

program
  .option('-c, --cwd <path>', '工作目录', process.cwd())
  .option('--config <path>', '配置文件路径');

registerInitCommand(program);
registerPromptCommand(program);
registerRunCommand(program);
registerBatchCommand(program);
registerReviewCommand(program);
registerHistoryCommand(program);
registerExportCommand(program);

program.addHelpText('beforeAll', `
${chalk.bold.cyan('╔══════════════════════════════════════╗')}
${chalk.bold.cyan('║  AI Content CLI (aict)              ║')}
${chalk.bold.cyan('║  AI 内容处理命令行工具              ║')}
${chalk.bold.cyan('╚══════════════════════════════════════╝')}
`);

program.addHelpText('after', `
${chalk.cyan('命令列表:')}
  ${chalk.white('init')}        初始化项目配置
  ${chalk.white('prompt')}      提示词模板管理 (list/create/view/edit/delete/preview/duplicate)
  ${chalk.white('run')}         运行单次任务 (template/text/result)
  ${chalk.white('batch')}       批量处理任务 (run/list/resume/retry-failed/show)
  ${chalk.white('review')}      审核和质检 (task/batch/quality/compare/pending)
  ${chalk.white('history')}     历史记录与统计 (list/stats/cost/replay/estimate)
  ${chalk.white('export')}      导出结果和报表 (csv/excel/merge/report)

${chalk.cyan('示例:')}
  ${chalk.gray('初始化项目')}
  $ aict init -y

  ${chalk.gray('创建模板')}
  $ aict prompt create

  ${chalk.gray('运行任务')}
  $ aict run template <templateId>

  ${chalk.gray('批量处理')}
  $ aict batch run <templateId> -i ./input

  ${chalk.gray('审核结果')}
  $ aict review task <taskId>

  ${chalk.gray('查看统计')}
  $ aict history stats

  ${chalk.gray('导出Excel')}
  $ aict export excel -o results.xlsx
`);

program.parse(process.argv);
