import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
import { loadConfig } from '../core/config';
import { getTemplate, addTask, loadHistory } from '../core/storage';
import { callAIWithRetry } from '../core/ai-client';
import { validateVariables, renderTemplate } from '../core/template';
import { checkQuality } from '../core/quality';
import { estimateTaskCost, formatCost } from '../core/cost';
import { TaskResult, AICallOptions } from '../types';
import { generateId, formatDate, parseVariables } from '../utils';

export function registerRunCommand(program: Command): void {
  const runCmd = program
    .command('run')
    .description('运行单次 AI 任务');

  runCmd
    .command('template <templateId>')
    .description('使用模板运行任务')
    .option('-v, --var <variables...>', '变量值，格式: 变量名=值')
    .option('-n, --name <name>', '任务名称')
    .option('--no-quality', '跳过敏检')
    .option('--no-preview', '跳过预览，直接运行')
    .option('-y, --yes', '自动确认，跳过交互')
    .option('-m, --model <model>', '覆盖默认模型')
    .option('--retries <retries>', '最大重试次数', parseInt)
    .action(async (templateId, options) => {
      const config = loadConfig();
      const template = getTemplate(templateId);

      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      let variables: Record<string, any> = {};

      if (options.var && options.var.length > 0) {
        variables = parseVariables(options.var);
      } else if (template.variables.length > 0) {
        if (options.yes) {
          console.log(chalk.red(`✗ 使用 -y 模式时必须通过 -v 提供所有变量值`));
          console.log(chalk.gray(`需要的变量: ${template.variables.map(v => v.name).join(', ')}`));
          return;
        }
        console.log(chalk.cyan('\n请输入变量值:\n'));
        const questions = template.variables.map(v => ({
          type: v.type === 'text' ? 'editor' : 'input',
          name: v.name,
          message: `${v.name}${v.required ? ' *' : ''} (${v.description}):`,
          default: v.default,
        }));
        variables = await inquirer.prompt(questions as any);
      }

      const validation = validateVariables(template, variables);
      if (!validation.valid) {
        if (validation.missing.length > 0) {
          console.log(chalk.red(`✗ 缺少必填变量: ${validation.missing.join(', ')}`));
        }
        for (const err of validation.errors) {
          console.log(chalk.red(`  ✗ ${err}`));
        }
        return;
      }

      const renderedUserPrompt = renderTemplate(template.userPrompt, variables);
      const renderedSystemPrompt = template.systemPrompt
        ? renderTemplate(template.systemPrompt, variables)
        : undefined;

      const estimatedCost = estimateTaskCost(template.userPrompt, variables, config);

      if (options.preview !== false && !options.yes) {
        console.log(chalk.bold.cyan('\n📋 任务预览\n'));
        console.log(chalk.cyan(`模板: ${template.name}`));
        console.log(chalk.cyan(`模型: ${template.model || config.defaultModel}`));
        console.log(chalk.cyan(`预估成本: ${formatCost(estimatedCost)}`));
        console.log(chalk.cyan(`\n提示词预览:`));
        console.log(chalk.gray(renderedUserPrompt.substr(0, 200) + (renderedUserPrompt.length > 200 ? '...' : '')));

        const confirm = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: '确认执行此任务？',
            default: true,
          },
        ]);

        if (!confirm.confirmed) {
          console.log(chalk.gray('已取消任务'));
          return;
        }
      }

      const taskName = options.name || `${template.name}_${generateId()}`;
      const taskId = generateId('task');

      const task: TaskResult = {
        id: taskId,
        taskName,
        templateId: template.id,
        templateName: template.name,
        input: variables,
        output: '',
        model: template.model || config.defaultModel,
        tokens: { input: 0, output: 0, total: 0 },
        cost: 0,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };

      addTask(task);

      const spinner = ora('正在执行 AI 任务...').start();

      try {
        const maxRetries = options.retries !== undefined ? options.retries : config.maxRetries;

        const callOptions: AICallOptions = {
          model: options.model || template.model || config.defaultModel,
          temperature: template.temperature,
          maxTokens: template.maxTokens,
          systemPrompt: renderedSystemPrompt,
          userPrompt: renderedUserPrompt,
        };

        const result = await callAIWithRetry(callOptions, config, maxRetries);

        task.output = result.content;
        task.tokens = result.tokens;
        task.cost = result.cost;
        task.status = 'success';
        task.completedAt = new Date().toISOString();
        task.retryCount = 0;

        if (options.quality !== false) {
          const qualityResult = checkQuality(result.content, config);
          task.qualityCheck = qualityResult;
        }

        addTask(task);

        spinner.succeed('任务执行成功！');

        console.log('\n' + chalk.bold.cyan('📄 任务结果\n'));
        console.log(chalk.cyan(`任务ID: ${task.id}`));
        console.log(chalk.cyan(`任务名称: ${task.taskName}`));
        console.log(chalk.cyan(`模型: ${task.model}`));
        console.log(chalk.cyan(`Token 消耗: ${task.tokens.total} (输入: ${task.tokens.input}, 输出: ${task.tokens.output})`));
        console.log(chalk.cyan(`成本: ${formatCost(task.cost)}`));

        if (task.qualityCheck) {
          const qualityColor = task.qualityCheck.overall === 'pass' ? chalk.green :
            task.qualityCheck.overall === 'warning' ? chalk.yellow : chalk.red;
          console.log(chalk.cyan(`质检结果: ${qualityColor(task.qualityCheck.overall.toUpperCase())}`));
          if (task.qualityCheck.hasSensitiveWords) {
            console.log(chalk.red(`  敏感词: ${task.qualityCheck.sensitiveWords.join(', ')}`));
          }
          console.log(chalk.cyan(`  语气: ${task.qualityCheck.toneLabel} (${task.qualityCheck.toneScore.toFixed(2)})`));
          console.log(chalk.cyan(`  可读性: ${task.qualityCheck.readabilityScore}/100`));
        }

        console.log(chalk.cyan('\n输出内容:'));
        console.log(chalk.white(task.output));
        console.log('');

      } catch (error: any) {
        task.status = 'failed';
        task.error = error.message;
        addTask(task);

        spinner.fail('任务执行失败');
        console.log(chalk.red(`错误: ${error.message}`));
      }
    });

  runCmd
    .command('text')
    .description('直接输入文本运行任务')
    .option('-p, --prompt <prompt>', '用户提示词')
    .option('-s, --system <system>', '系统提示词')
    .option('-m, --model <model>', '使用的模型')
    .option('-n, --name <name>', '任务名称')
    .option('-t, --temperature <temperature>', 'Temperature', parseFloat)
    .option('--max-tokens <tokens>', '最大 Token 数', parseInt)
    .option('--no-quality', '跳过敏检')
    .action(async (options) => {
      const config = loadConfig();
      let userPrompt = options.prompt;

      if (!userPrompt) {
        const answers = await inquirer.prompt([
          {
            type: 'editor',
            name: 'prompt',
            message: '输入提示词:',
          },
        ]);
        userPrompt = answers.prompt;
      }

      if (!userPrompt || userPrompt.trim().length === 0) {
        console.log(chalk.red('✗ 提示词不能为空'));
        return;
      }

      const estimatedCost = estimateTaskCost(userPrompt, {}, config);
      console.log(chalk.cyan(`\n预估成本: ${formatCost(estimatedCost)}`));

      const confirm = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: '确认执行？',
          default: true,
        },
      ]);

      if (!confirm.confirmed) {
        console.log(chalk.gray('已取消'));
        return;
      }

      const taskId = generateId('task');
      const taskName = options.name || `direct_${generateId()}`;

      const task: TaskResult = {
        id: taskId,
        taskName,
        templateId: 'direct',
        templateName: '直接调用',
        input: { prompt: userPrompt },
        output: '',
        model: options.model || config.defaultModel,
        tokens: { input: 0, output: 0, total: 0 },
        cost: 0,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };

      addTask(task);

      const spinner = ora('正在执行...').start();

      try {
        const result = await callAIWithRetry({
          model: options.model || config.defaultModel,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          systemPrompt: options.system,
          userPrompt,
        }, config, config.maxRetries);

        task.output = result.content;
        task.tokens = result.tokens;
        task.cost = result.cost;
        task.status = 'success';
        task.completedAt = new Date().toISOString();

        if (options.quality !== false) {
          task.qualityCheck = checkQuality(result.content, config);
        }

        addTask(task);
        spinner.succeed('完成！');

        console.log('\n' + chalk.cyan('输出:'));
        console.log(task.output);
        console.log(chalk.gray(`\n成本: ${formatCost(task.cost)} | Tokens: ${task.tokens.total}`));

      } catch (error: any) {
        task.status = 'failed';
        task.error = error.message;
        addTask(task);
        spinner.fail('失败');
        console.log(chalk.red(error.message));
      }
    });

  runCmd
    .command('result <taskId>')
    .description('查看任务结果')
    .action((taskId) => {
      const history = loadHistory();
      const task = history.tasks.find(t => t.id === taskId);

      if (!task) {
        console.log(chalk.red(`✗ 任务不存在: ${taskId}`));
        return;
      }

      console.log(chalk.bold.cyan(`\n📄 任务详情: ${task.taskName}\n`));
      console.log(chalk.cyan('ID: ') + task.id);
      console.log(chalk.cyan('状态: ') + (task.status === 'success' ? chalk.green('成功') : chalk.red('失败')));
      console.log(chalk.cyan('模板: ') + task.templateName);
      console.log(chalk.cyan('模型: ') + task.model);
      console.log(chalk.cyan('创建时间: ') + formatDate(task.createdAt));
      if (task.completedAt) {
        console.log(chalk.cyan('完成时间: ') + formatDate(task.completedAt));
      }
      console.log(chalk.cyan('Token 消耗: ') + `${task.tokens.total} (in: ${task.tokens.input}, out: ${task.tokens.output})`);
      console.log(chalk.cyan('成本: ') + formatCost(task.cost));
      console.log(chalk.cyan('重试次数: ') + task.retryCount);

      if (task.qualityCheck) {
        console.log(chalk.cyan('\n质检结果: '));
        const qc = task.qualityCheck;
        const overallColor = qc.overall === 'pass' ? chalk.green : qc.overall === 'warning' ? chalk.yellow : chalk.red;
        console.log(`  总体: ${overallColor(qc.overall.toUpperCase())}`);
        console.log(`  敏感词: ${qc.hasSensitiveWords ? chalk.red(qc.sensitiveWords.join(', ')) : chalk.green('无')}`);
        console.log(`  语气: ${qc.toneLabel} (${qc.toneScore.toFixed(2)})`);
        console.log(`  可读性: ${qc.readabilityScore}/100`);
      }

      console.log(chalk.cyan('\n输入:'));
      console.log(JSON.stringify(task.input, null, 2));

      console.log(chalk.cyan('\n输出:'));
      console.log(task.output);

      if (task.error) {
        console.log(chalk.red('\n错误: ') + task.error);
      }
      console.log('');
    });
}
