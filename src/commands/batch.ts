import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../core/config';
import { getTemplate, addBatch, getBatch, addTask, loadHistory } from '../core/storage';
import { callAIWithRetry } from '../core/ai-client';
import { renderTemplate, validateVariables } from '../core/template';
import { checkQuality } from '../core/quality';
import { estimateBatchCost, formatCost } from '../core/cost';
import { BatchJob, TaskResult, PromptTemplate } from '../types';
import { generateId, formatDate, readTextFilesFromDir, sleep, parseVariables } from '../utils';

let isPaused = false;
let shouldStop = false;

export function registerBatchCommand(program: Command): void {
  const batchCmd = program
    .command('batch')
    .description('批量处理任务');

  batchCmd
    .command('run <templateId>')
    .description('批量运行任务')
    .option('-i, --input <dir>', '输入文件夹路径')
    .option('-o, --output <dir>', '输出文件夹路径')
    .option('-f, --files <files...>', '指定输入文件列表')
    .option('-n, --name <name>', '批量任务名称')
    .option('-c, --concurrency <number>', '并发数', parseInt)
    .option('-r, --retries <retries>', '失败重试次数', parseInt)
    .option('-y, --yes', '自动确认，跳过交互')
    .option('--no-quality', '跳过敏检')
    .option('--dry-run', '仅预览，不实际执行')
    .option('--var <variables...>', '公共变量')
    .action(async (templateId, options) => {
      const config = loadConfig();
      const template = getTemplate(templateId);

      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      const tpl = template;

      let inputFiles: { fileName: string; content: string; filePath: string }[] = [];
      let inputDir = options.input;

      if (options.files && options.files.length > 0) {
        for (const file of options.files) {
          if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf-8');
            inputFiles.push({
              fileName: path.basename(file),
              content,
              filePath: file,
            });
          }
        }
      } else if (options.input) {
        inputFiles = readTextFilesFromDir(options.input);
      } else {
        if (options.yes) {
          console.log(chalk.red('✗ 使用 -y 模式时必须通过 -i 指定输入目录或 -f 指定文件'));
          return;
        }
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'inputDir',
            message: '输入文件夹路径:',
            validate: (input: string) => fs.existsSync(input) || '文件夹不存在',
          },
        ]);
        inputDir = answers.inputDir;
        inputFiles = readTextFilesFromDir(inputDir);
      }

      if (inputFiles.length === 0) {
        console.log(chalk.yellow('未找到任何输入文件'));
        return;
      }

      const commonVars = options.var && options.var.length > 0
        ? parseVariables(options.var)
        : {};

      const autoProvidedVars = new Set(['content', 'fileName', 'sourceFile']);
      const requiredVars = tpl.variables.filter(v => v.required);
      const missingVars = requiredVars
        .filter(v => !autoProvidedVars.has(v.name) && commonVars[v.name] === undefined)
        .map(v => v.name);

      if (missingVars.length > 0) {
        console.log(chalk.red(`✗ 缺少必填变量: ${missingVars.join(', ')}`));
        console.log(chalk.gray(`请使用 --var ${missingVars.map(v => `${v}=值`).join(' ')} 提供这些变量`));
        console.log(chalk.gray(`模板变量: ${tpl.variables.map(v => v.name + (v.required ? ' *' : '')).join(', ')}`));
        return;
      }

      if (Object.keys(commonVars).length > 0) {
        console.log(chalk.cyan(`公共变量: ${Object.keys(commonVars).length} 个`));
      }

      const batchName = options.name || `batch_${generateId()}`;
      const batchId = generateId('batch');
      const concurrency = options.concurrency || config.concurrency;
      const maxRetries = options.retries !== undefined ? options.retries : config.maxRetries;

      const sampleVars = { ...commonVars, content: '', fileName: '' };
      const samplePrompt = renderTemplate(tpl.userPrompt, sampleVars);
      const sampleSystemPrompt = tpl.systemPrompt ? renderTemplate(tpl.systemPrompt, sampleVars) : '';
      const promptPerFileLength = samplePrompt.length + sampleSystemPrompt.length;
      const estimatedTotalInputTokens = promptPerFileLength * inputFiles.length / 4;
      const estimatedOutputTokens = 500 * inputFiles.length;
      const { totalCost } = estimateBatchCost(
        Array(inputFiles.length).fill(samplePrompt),
        config
      );

      console.log(chalk.bold.cyan('\n📦 批量任务预览\n'));
      console.log(chalk.cyan(`批量任务: ${batchName}`));
      console.log(chalk.cyan(`模板: ${tpl.name}`));
      console.log(chalk.cyan(`文件数量: ${inputFiles.length}`));
      console.log(chalk.cyan(`并发数: ${concurrency}`));
      console.log(chalk.cyan(`预估成本: ${formatCost(totalCost)}`));
      console.log(chalk.cyan(`预估 Token: 输入 ~${Math.round(estimatedTotalInputTokens)}, 输出 ~${estimatedOutputTokens}`));

      if (options.dryRun) {
        console.log(chalk.gray('\n(Dry Run 模式，未实际执行)'));
        return;
      }

      if (!options.yes) {
        const confirm = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: '确认开始批量处理？',
            default: true,
          },
        ]);

        if (!confirm.confirmed) {
          console.log(chalk.gray('已取消'));
          return;
        }
      }

      const tasks: TaskResult[] = inputFiles.map((file, index) => ({
        id: generateId('task'),
        taskName: `${tpl.name}_${file.fileName}`,
        templateId: tpl.id,
        templateName: tpl.name,
        input: {
          ...commonVars,
          content: file.content,
          fileName: file.fileName,
          sourceFile: file.filePath,
        },
        output: '',
        model: tpl.model || config.defaultModel,
        tokens: { input: 0, output: 0, total: 0 },
        cost: 0,
        status: 'pending' as const,
        retryCount: 0,
        createdAt: new Date().toISOString(),
        sourceFile: file.filePath,
      }));

      const batch: BatchJob = {
        id: batchId,
        name: batchName,
        templateId: template.id,
        status: 'running',
        totalTasks: tasks.length,
        completedTasks: 0,
        failedTasks: 0,
        tasks,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        inputDir,
        outputDir: options.output,
      };

      addBatch(batch);

      console.log(chalk.cyan(`\n批量任务已启动: ${batchId}`));
      console.log(chalk.gray('按 Ctrl+C 暂停任务\n'));

      process.on('SIGINT', () => {
        if (!isPaused) {
          isPaused = true;
          console.log('\n' + chalk.yellow('⏸  任务已暂停，保存进度中...'));
          batch.status = 'paused';
          addBatch(batch);
          console.log(chalk.gray(`使用 aict batch resume ${batchId} 继续执行`));
          process.exit(0);
        }
      });

      const spinner = ora(`处理中: 0/${tasks.length} 成功`).start();

      let currentIndex = 0;
      let completed = 0;
      let failed = 0;

      async function processTask(task: TaskResult): Promise<void> {
        if (isPaused || shouldStop) return;

        try {
          const userPrompt = renderTemplate(tpl.userPrompt, task.input);
          const systemPrompt = tpl.systemPrompt
            ? renderTemplate(tpl.systemPrompt, task.input)
            : undefined;

          const result = await callAIWithRetry({
            model: tpl.model || config.defaultModel,
            temperature: tpl.temperature,
            maxTokens: tpl.maxTokens,
            systemPrompt,
            userPrompt,
          }, config, maxRetries);

          task.output = result.content;
          task.tokens = result.tokens;
          task.cost = result.cost;
          task.status = 'success';
          task.completedAt = new Date().toISOString();

          if (options.quality !== false) {
            task.qualityCheck = checkQuality(result.content, config);
          }

          if (options.output) {
            const outputDir = options.output;
            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }
            const outputFile = path.join(outputDir, `${path.basename(task.sourceFile || task.taskName, path.extname(task.sourceFile || task.taskName))}_output.txt`);
            fs.writeFileSync(outputFile, result.content, 'utf-8');
          }

          completed++;
          batch.completedTasks = completed;
          addTask(task);

        } catch (error: any) {
          task.status = 'failed';
          task.error = error.message;
          task.retryCount = maxRetries;
          failed++;
          batch.failedTasks = failed;
          addTask(task);
        }
      }

      async function processQueue(): Promise<void> {
        const workers: Promise<void>[] = [];

        for (let i = 0; i < concurrency && currentIndex < tasks.length; i++) {
          const task = tasks[currentIndex++];
          workers.push(processTask(task));
        }

        while (currentIndex < tasks.length && !isPaused && !shouldStop) {
          await Promise.race(workers);
          const idx = workers.findIndex(w => false);
          const completedIndex = -1;

          if (currentIndex < tasks.length) {
            const task = tasks[currentIndex++];
            workers.push(processTask(task));
          }

          spinner.text = `处理中: ${completed}/${tasks.length} 成功, ${failed} 失败`;

          await sleep(50);
        }

        await Promise.all(workers);
      }

      await processQueue();

      if (!isPaused) {
        batch.status = completed === tasks.length ? 'completed' : 'failed';
        batch.completedAt = new Date().toISOString();
      }

      addBatch(batch);

      const totalCostActual = tasks.reduce((sum, t) => sum + t.cost, 0);
      const totalTokens = tasks.reduce((sum, t) => sum + t.tokens.total, 0);

      if (isPaused) {
        spinner.info('任务已暂停');
      } else if (failed === 0) {
        spinner.succeed('批量任务完成！');
      } else {
        spinner.warn(`批量任务完成，${failed} 个任务失败`);
      }

      console.log(chalk.cyan(`\n📊 批量任务统计`));
      console.log(chalk.cyan(`总任务数: ${tasks.length}`));
      console.log(chalk.green(`成功: ${completed}`));
      if (failed > 0) console.log(chalk.red(`失败: ${failed}`));
      console.log(chalk.cyan(`总成本: ${formatCost(totalCostActual)}`));
      console.log(chalk.cyan(`总 Token: ${totalTokens}`));
      console.log(chalk.cyan(`批量任务ID: ${batchId}`));
      console.log('');
    });

  batchCmd
    .command('list')
    .description('列出批量任务')
    .option('-n, --limit <number>', '显示数量', parseInt)
    .option('--status <status>', '按状态筛选')
    .action((options) => {
      const history = loadHistory();
      let batches = [...history.batches];

      if (options.status) {
        batches = batches.filter(b => b.status === options.status);
      }

      batches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (options.limit) {
        batches = batches.slice(0, options.limit);
      }

      if (batches.length === 0) {
        console.log(chalk.yellow('暂无批量任务记录'));
        return;
      }

      const Table = require('cli-table3');
      const table = new Table({
        head: [chalk.cyan('ID'), chalk.cyan('名称'), chalk.cyan('状态'), chalk.cyan('进度'), chalk.cyan('创建时间')],
        colWidths: [18, 25, 12, 15, 20],
      });

      for (const batch of batches) {
        const statusColors: Record<string, any> = {
          running: chalk.blue,
          paused: chalk.yellow,
          completed: chalk.green,
          failed: chalk.red,
        };
        const statusColor = statusColors[batch.status] || chalk.gray;
        const progress = `${batch.completedTasks}/${batch.totalTasks}`;

        table.push([
          batch.id.substr(0, 15) + '...',
          batch.name,
          statusColor(batch.status),
          progress,
          formatDate(batch.createdAt),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.gray(`\n共 ${batches.length} 个批量任务`));
    });

  batchCmd
    .command('resume <batchId>')
    .description('继续暂停的批量任务')
    .option('-c, --concurrency <number>', '并发数', parseInt)
    .option('-r, --retries <retries>', '失败重试次数', parseInt)
    .action(async (batchId, options) => {
      const config = loadConfig();
      const batch = getBatch(batchId);

      if (!batch) {
        console.log(chalk.red(`✗ 批量任务不存在: ${batchId}`));
        return;
      }

      if (batch.status !== 'paused') {
        console.log(chalk.yellow(`任务状态为 ${batch.status}，无需继续`));
        return;
      }

      const template = getTemplate(batch.templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${batch.templateId}`));
        return;
      }

      const currentBatch = batch;
      const tpl = template;

      const concurrency = options.concurrency || config.concurrency;
      const maxRetries = options.retries !== undefined ? options.retries : config.maxRetries;

      isPaused = false;
      currentBatch.status = 'running';
      addBatch(currentBatch);

      const pendingTasks = currentBatch.tasks.filter(t => t.status === 'pending' || t.status === 'failed');

      console.log(chalk.cyan(`\n继续执行批量任务: ${currentBatch.name}`));
      console.log(chalk.cyan(`剩余任务: ${pendingTasks.length}/${currentBatch.totalTasks}`));

      const spinner = ora('处理中...').start();

      let completed = currentBatch.completedTasks;
      let failed = currentBatch.failedTasks;

      async function processTask(task: TaskResult): Promise<void> {
        try {
          const userPrompt = renderTemplate(tpl.userPrompt, task.input);
          const systemPrompt = tpl.systemPrompt
            ? renderTemplate(tpl.systemPrompt, task.input)
            : undefined;

          const result = await callAIWithRetry({
            model: tpl.model || config.defaultModel,
            temperature: tpl.temperature,
            maxTokens: tpl.maxTokens,
            systemPrompt,
            userPrompt,
          }, config, maxRetries);

          task.output = result.content;
          task.tokens = result.tokens;
          task.cost = result.cost;
          task.status = 'success';
          task.completedAt = new Date().toISOString();
          task.qualityCheck = checkQuality(result.content, config);

          completed++;
          currentBatch.completedTasks = completed;
          addTask(task);

        } catch (error: any) {
          task.status = 'failed';
          task.error = error.message;
          failed++;
          currentBatch.failedTasks = failed;
          addTask(task);
        }
      }

      let index = 0;
      async function processQueue() {
        const workers: Promise<void>[] = [];

        for (let i = 0; i < concurrency && index < pendingTasks.length; i++) {
          workers.push(processTask(pendingTasks[index++]));
        }

        while (index < pendingTasks.length) {
          await Promise.race(workers);
          if (index < pendingTasks.length) {
            workers.push(processTask(pendingTasks[index++]));
          }
          spinner.text = `处理中: ${completed}/${currentBatch.totalTasks}`;
          await sleep(50);
        }

        await Promise.all(workers);
      }

      await processQueue();

      currentBatch.status = failed < currentBatch.totalTasks ? 'completed' : 'failed';
      currentBatch.completedAt = new Date().toISOString();
      addBatch(currentBatch);

      spinner.succeed('任务完成');
      console.log(chalk.green(`\n成功: ${completed}, 失败: ${failed}`));
    });

  batchCmd
    .command('retry-failed <batchId>')
    .description('重试失败的任务')
    .option('-c, --concurrency <number>', '并发数', parseInt)
    .option('-r, --retries <retries>', '重试次数', parseInt)
    .action(async (batchId, options) => {
      const config = loadConfig();
      const batch = getBatch(batchId);

      if (!batch) {
        console.log(chalk.red(`✗ 批量任务不存在: ${batchId}`));
        return;
      }

      const failedTasks = batch.tasks.filter(t => t.status === 'failed');
      if (failedTasks.length === 0) {
        console.log(chalk.green('没有失败的任务需要重试'));
        return;
      }

      const template = getTemplate(batch.templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在`));
        return;
      }

      const currentBatch = batch;
      const tpl = template;

      console.log(chalk.cyan(`\n将重试 ${failedTasks.length} 个失败任务`));

      const confirm = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: '确认重试？',
          default: true,
        },
      ]);

      if (!confirm.confirmed) {
        console.log(chalk.gray('已取消'));
        return;
      }

      const concurrency = options.concurrency || config.concurrency;
      const maxRetries = options.retries !== undefined ? options.retries : config.maxRetries;

      const spinner = ora('重试中...').start();
      let successCount = 0;
      let failCount = 0;

      async function retryTask(task: TaskResult) {
        try {
          const userPrompt = renderTemplate(tpl.userPrompt, task.input);
          const systemPrompt = tpl.systemPrompt
            ? renderTemplate(tpl.systemPrompt, task.input)
            : undefined;

          const result = await callAIWithRetry({
            model: task.model,
            temperature: tpl.temperature,
            maxTokens: tpl.maxTokens,
            systemPrompt,
            userPrompt,
          }, config, maxRetries);

          task.output = result.content;
          task.tokens = result.tokens;
          task.cost = result.cost;
          task.status = 'success';
          task.completedAt = new Date().toISOString();
          task.retryCount = (task.retryCount || 0) + 1;
          task.qualityCheck = checkQuality(result.content, config);

          successCount++;
          currentBatch.completedTasks++;
          currentBatch.failedTasks--;
          addTask(task);

        } catch (error: any) {
          task.error = error.message;
          task.retryCount = (task.retryCount || 0) + 1;
          failCount++;
          addTask(task);
        }
      }

      let index = 0;
      async function processQueue() {
        const workers: Promise<void>[] = [];
        for (let i = 0; i < concurrency && index < failedTasks.length; i++) {
          workers.push(retryTask(failedTasks[index++]));
        }
        while (index < failedTasks.length) {
          await Promise.race(workers);
          if (index < failedTasks.length) {
            workers.push(retryTask(failedTasks[index++]));
          }
          spinner.text = `重试中: ${successCount}成功, ${failCount}失败`;
          await sleep(50);
        }
        await Promise.all(workers);
      }

      await processQueue();
      addBatch(currentBatch);

      spinner.succeed('重试完成');
      console.log(chalk.green(`成功: ${successCount}`));
      if (failCount > 0) console.log(chalk.red(`仍失败: ${failCount}`));
    });

  batchCmd
    .command('show <batchId>')
    .description('查看批量任务详情')
    .action((batchId) => {
      const batch = getBatch(batchId);
      if (!batch) {
        console.log(chalk.red(`✗ 批量任务不存在: ${batchId}`));
        return;
      }

      const statusColors: Record<string, any> = {
        running: chalk.blue,
        paused: chalk.yellow,
        completed: chalk.green,
        failed: chalk.red,
      };

      const totalCost = batch.tasks.reduce((sum, t) => sum + t.cost, 0);
      const totalTokens = batch.tasks.reduce((sum, t) => sum + t.tokens.total, 0);

      console.log(chalk.bold.cyan(`\n📦 批量任务详情: ${batch.name}\n`));
      console.log(chalk.cyan('ID: ') + batch.id);
      console.log(chalk.cyan('状态: ') + (statusColors[batch.status]?.(batch.status) || batch.status));
      console.log(chalk.cyan('模板: ') + batch.templateId);
      console.log(chalk.cyan('创建时间: ') + formatDate(batch.createdAt));
      console.log(chalk.cyan('总任务数: ') + batch.totalTasks);
      console.log(chalk.green('成功: ') + batch.completedTasks);
      console.log(chalk.red('失败: ') + batch.failedTasks);
      console.log(chalk.cyan('总成本: ') + formatCost(totalCost));
      console.log(chalk.cyan('总 Token: ') + totalTokens);

      console.log(chalk.cyan('\n任务列表:'));
      const Table = require('cli-table3');
      const table = new Table({
        head: [chalk.cyan('#'), chalk.cyan('任务'), chalk.cyan('状态'), chalk.cyan('成本'), chalk.cyan('质检')],
        colWidths: [5, 30, 10, 10, 10],
      });

      batch.tasks.forEach((task, idx) => {
        const taskStatusColor = task.status === 'success' ? chalk.green :
          task.status === 'failed' ? chalk.red : chalk.yellow;
        const qcStatus = task.qualityCheck ? (
          task.qualityCheck.overall === 'pass' ? chalk.green('✓') :
            task.qualityCheck.overall === 'warning' ? chalk.yellow('!') : chalk.red('✗')
        ) : '-';

        table.push([
          String(idx + 1),
          task.taskName.substr(0, 25),
          taskStatusColor(task.status),
          formatCost(task.cost),
          qcStatus,
        ]);
      });

      console.log(table.toString());
      console.log('');
    });
}
