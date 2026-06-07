import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
import * as path from 'path';
import { loadConfig } from '../core/config';
import { getTask, addTask, getBatch, loadHistory } from '../core/storage';
import { callAIWithRetry } from '../core/ai-client';
import { checkQuality, rewriteTonePrompt, summaryPrompt } from '../core/quality';
import { formatCost } from '../core/cost';
import { TaskResult, TaskResultVersion } from '../types';
import { formatDate } from '../utils';

export function registerReviewCommand(program: Command): void {
  const reviewCmd = program
    .command('review')
    .description('审核和质检任务结果');

  reviewCmd
    .command('task <taskId>')
    .description('审核单个任务结果')
    .option('--no-quality', '跳过自动质检')
    .option('--auto-approve', '自动通过质检通过的内容')
    .action(async (taskId, options) => {
      const config = loadConfig();
      const task = getTask(taskId);

      if (!task) {
        console.log(chalk.red(`✗ 任务不存在: ${taskId}`));
        return;
      }

      if (task.status !== 'success') {
        console.log(chalk.yellow(`任务状态为 ${task.status}，无法审核`));
        return;
      }

      console.log(chalk.bold.cyan(`\n📋 任务审核: ${task.taskName}\n`));
      console.log(chalk.cyan('任务ID: ') + task.id);
      console.log(chalk.cyan('模板: ') + task.templateName);
      console.log(chalk.cyan('模型: ') + task.model);
      console.log(chalk.cyan('成本: ') + formatCost(task.cost));
      console.log('');

      let qualityCheck = task.qualityCheck;

      if (options.quality !== false && !qualityCheck) {
        const spinner = ora('正在进行自动质检...').start();
        qualityCheck = checkQuality(task.output, config);
        task.qualityCheck = qualityCheck;
        addTask(task);
        spinner.succeed('质检完成');
      }

      if (qualityCheck) {
        displayQualityResult(qualityCheck);
      }

      console.log(chalk.cyan('\n--- 输出内容 ---\n'));
      console.log(task.output);
      console.log('');

      if (options.autoApprove && qualityCheck?.overall === 'pass') {
        task.reviewed = true;
        task.reviewStatus = 'approved';
        task.reviewNotes = '自动审批通过';
        addTask(task);
        console.log(chalk.green('✓ 内容质检通过，已自动批准'));
        return;
      }

      const action = await inquirer.prompt([
        {
          type: 'list',
          name: 'choice',
          message: '请选择审核操作:',
          choices: [
            { name: '批准 (Approved)', value: 'approve' },
            { name: '拒绝 (Rejected)', value: 'reject' },
            { name: '语气改写', value: 'rewrite' },
            { name: '生成摘要', value: 'summary' },
            { name: '生成新版本对比', value: 'version' },
            { name: '添加备注', value: 'note' },
            { name: '退出', value: 'exit' },
          ],
        },
      ]);

      switch (action.choice) {
        case 'approve':
          task.reviewed = true;
          task.reviewStatus = 'approved';
          const noteApprove = await inquirer.prompt([{
            type: 'input',
            name: 'notes',
            message: '审核备注 (可选):',
          }]);
          task.reviewNotes = noteApprove.notes || '批准发布';
          addTask(task);
          console.log(chalk.green('✓ 已批准'));
          break;

        case 'reject':
          task.reviewed = true;
          task.reviewStatus = 'rejected';
          const noteReject = await inquirer.prompt([{
            type: 'input',
            name: 'notes',
            message: '拒绝原因:',
          }]);
          task.reviewNotes = noteReject.notes;
          addTask(task);
          console.log(chalk.red('✗ 已拒绝'));
          break;

        case 'rewrite':
          await handleRewrite(task, config);
          break;

        case 'summary':
          await handleSummary(task, config);
          break;

        case 'version':
          await handleNewVersion(task, config);
          break;

        case 'note':
          const note = await inquirer.prompt([{
            type: 'editor',
            name: 'notes',
            message: '备注内容:',
          }]);
          task.reviewNotes = note.notes;
          addTask(task);
          console.log(chalk.green('✓ 备注已保存'));
          break;

        case 'exit':
          console.log(chalk.gray('已退出审核'));
          break;
      }
    });

  reviewCmd
    .command('batch <batchId>')
    .description('批量审核任务结果')
    .option('--only-pending', '只审核未审核的任务')
    .option('--auto-mode', '按质检分组自动模式')
    .option('--skip-failed', '跳过失败任务（默认跳过）')
    .option('--include-failed', '包含失败任务')
    .action(async (batchId, options) => {
      const config = loadConfig();
      const batch = getBatch(batchId);

      if (!batch) {
        console.log(chalk.red(`✗ 批量任务不存在: ${batchId}`));
        return;
      }

      let tasks = [...batch.tasks];

      if (options.onlyPending) {
        tasks = tasks.filter(t => !t.reviewStatus || t.reviewStatus === 'pending');
      }

      const successTasks = tasks.filter(t => t.status === 'success');
      const failedTasks = tasks.filter(t => t.status === 'failed');

      for (const task of successTasks) {
        if (!task.qualityCheck) {
          task.qualityCheck = checkQuality(task.output, config);
          addTask(task);
        }
      }

      const passTasks = successTasks.filter(t => t.qualityCheck?.overall === 'pass');
      const warningTasks = successTasks.filter(t => t.qualityCheck?.overall === 'warning');
      const failQcTasks = successTasks.filter(t => t.qualityCheck?.overall === 'fail');

      console.log(chalk.bold.cyan(`\n📋 批量审核: ${batch.name}\n`));
      console.log(chalk.cyan('【任务分组统计'));
      console.log(chalk.green(`  质检通过: ${passTasks.length} 条`));
      console.log(chalk.yellow(`  质检警告: ${warningTasks.length} 条`));
      console.log(chalk.red(`  质检失败: ${failQcTasks.length} 条`));
      console.log(chalk.gray(`  执行失败: ${failedTasks.length} 条`));
      console.log('');

      let approved = 0;
      let rejected = 0;
      let skipped = 0;

      if (passTasks.length > 0) {
        console.log(chalk.bold.green(`🔹 质检通过 (${passTasks.length} 条)`));

        let autoApprove = false;
        if (options.autoMode) {
          autoApprove = true;
        } else {
          const confirm = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'autoApprove',
              message: `质检通过的 ${passTasks.length} 条任务，是否全部批准？`,
              default: true,
            },
          ]);
          autoApprove = confirm.autoApprove;
        }

        if (autoApprove) {
          const commentAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'comment',
              message: '审核备注（可留空）:',
              default: '质检通过，批量批准',
            },
          ]);

          for (const task of passTasks) {
            if (task.reviewStatus === 'approved') continue;
            task.reviewed = true;
            task.reviewStatus = 'approved';
            task.reviewComment = commentAnswer.comment;
            task.reviewedAt = new Date().toISOString();
            addTask(task);
            approved++;
          }
          console.log(chalk.green(`  ✓ 已批准 ${approved} 条质检通过的任务\n`));
        } else {
          console.log(chalk.gray('  跳过质检通过的任务，逐条处理\n'));
          skipped += passTasks.length;
        }
      }

      if (warningTasks.length > 0) {
        console.log(chalk.bold.yellow(`� 质检警告 (${warningTasks.length} 条)`));
        console.log(chalk.yellow('  以下任务有轻微问题，建议逐条查看\n'));

        let batchAction = 'review';
        if (warningTasks.length > 1) {
          const choice = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: '如何处理质检警告的任务？',
              choices: [
                { name: '逐条审核（推荐）', value: 'review' },
                { name: '全部批准', value: 'approve-all' },
                { name: '全部跳过', value: 'skip-all' },
              ],
            },
          ]);
          batchAction = choice.action;
        }

        if (batchAction === 'approve-all') {
          const commentAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'comment',
              message: '审核备注（可留空）:',
              default: '质检警告，人工复核通过',
            },
          ]);

          for (const task of warningTasks) {
            if (task.reviewStatus === 'approved') continue;
            task.reviewed = true;
            task.reviewStatus = 'approved';
            task.reviewComment = commentAnswer.comment;
            task.reviewedAt = new Date().toISOString();
            addTask(task);
            approved++;
          }
          console.log(chalk.green(`  ✓ 已批准 ${warningTasks.length} 条质检警告的任务\n`));
        } else if (batchAction === 'skip-all') {
          skipped += warningTasks.length;
          console.log(chalk.gray('  已跳过质检警告的任务\n'));
        } else {
          for (let i = 0; i < warningTasks.length; i++) {
            const task = warningTasks[i];
            console.log(chalk.gray(`--- [${i + 1}/${warningTasks.length}] ${task.sourceFile ? path.basename(task.sourceFile) : task.taskName} ---`));

            if (task.qualityCheck) {
              console.log(chalk.yellow(`  质检: ${formatQualityOverall(task.qualityCheck)}`));
              if (task.qualityCheck.issues && task.qualityCheck.issues.length > 0) {
                console.log(chalk.yellow(`  问题: ${task.qualityCheck.issues.slice(0, 3).join('、')}`));
              }
            }
            console.log(`  预览: ${task.output.substring(0, 150)}...`);

            const action = await inquirer.prompt([
              {
                type: 'list',
                name: 'choice',
                message: '操作:',
                choices: [
                  { name: '批准', value: 'approve' },
                  { name: '拒绝', value: 'reject' },
                  { name: '查看全文', value: 'view' },
                  { name: '跳过', value: 'skip' },
                  { name: '剩余全部批准', value: 'approve-rest' },
                  { name: '退出', value: 'exit' },
                ],
              },
            ]);

            if (action.choice === 'approve') {
              const commentAnswer = await inquirer.prompt([
                {
                  type: 'input',
                  name: 'comment',
                  message: '审核备注（可留空）:',
                },
              ]);
              task.reviewed = true;
              task.reviewStatus = 'approved';
              task.reviewComment = commentAnswer.comment;
              task.reviewedAt = new Date().toISOString();
              addTask(task);
              approved++;
            } else if (action.choice === 'reject') {
              const commentAnswer = await inquirer.prompt([
                {
                  type: 'input',
                  name: 'comment',
                  message: '拒绝原因:',
                  default: '',
                },
              ]);
              task.reviewed = true;
              task.reviewStatus = 'rejected';
              task.reviewComment = commentAnswer.comment;
              task.reviewedAt = new Date().toISOString();
              addTask(task);
              rejected++;
            } else if (action.choice === 'view') {
              console.log('\n' + task.output + '\n');
              i--;
            } else if (action.choice === 'skip') {
              skipped++;
            } else if (action.choice === 'approve-rest') {
              for (let j = i; j < warningTasks.length; j++) {
                const t = warningTasks[j];
                if (t.reviewStatus === 'approved') continue;
                t.reviewed = true;
                t.reviewStatus = 'approved';
                t.reviewComment = '批量批准';
                t.reviewedAt = new Date().toISOString();
                addTask(t);
                approved++;
              }
              break;
            } else if (action.choice === 'exit') {
              break;
            }
          }
        }
      }

      if (failQcTasks.length > 0) {
        console.log(chalk.bold.red(`🔺 质检失败 (${failQcTasks.length} 条)`));

        if (options.includeFailed) {
          console.log(chalk.red('  以下任务质检未通过，建议拒绝处理\n'));

          const choice = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: '如何处理质检失败的任务？',
              choices: [
                { name: '逐条查看', value: 'review' },
                { name: '全部拒绝', value: 'reject-all' },
                { name: '全部跳过', value: 'skip-all' },
              ],
            },
          ]);

          if (choice.action === 'reject-all') {
            const commentAnswer = await inquirer.prompt([
              {
                type: 'input',
                name: 'comment',
                message: '拒绝原因:',
                default: '质检失败',
              },
            ]);

            for (const task of failQcTasks) {
              if (task.reviewStatus === 'rejected') continue;
              task.reviewed = true;
              task.reviewStatus = 'rejected';
              task.reviewComment = commentAnswer.comment;
              task.reviewedAt = new Date().toISOString();
              addTask(task);
              rejected++;
            }
            console.log(chalk.red(`  ✗ 已拒绝 ${failQcTasks.length} 条质检失败的任务\n`));
          } else if (choice.action === 'skip-all') {
            skipped += failQcTasks.length;
            console.log(chalk.gray('  已跳过质检失败的任务\n'));
          } else {
            for (let i = 0; i < failQcTasks.length; i++) {
              const task = failQcTasks[i];
              console.log(chalk.gray(`--- [${i + 1}/${failQcTasks.length}] ${task.sourceFile ? path.basename(task.sourceFile) : task.taskName} ---`));

              if (task.qualityCheck) {
                console.log(chalk.red(`  质检: ${formatQualityOverall(task.qualityCheck)}`));
                if (task.qualityCheck.issues) {
                  console.log(chalk.red(`  问题: ${task.qualityCheck.issues.join('、')}`));
                }
              }
              console.log(`  预览: ${task.output.substring(0, 150)}...`);

              const action = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'choice',
                  message: '操作:',
                  choices: [
                    { name: '批准（不推荐）', value: 'approve' },
                    { name: '拒绝', value: 'reject' },
                    { name: '查看全文', value: 'view' },
                    { name: '跳过', value: 'skip' },
                    { name: '剩余全部拒绝', value: 'reject-rest' },
                    { name: '退出', value: 'exit' },
                  ],
                },
              ]);

              if (action.choice === 'approve') {
                const commentAnswer = await inquirer.prompt([
                  {
                    type: 'input',
                    name: 'comment',
                    message: '审核备注（可留空）:',
                  },
                ]);
                task.reviewed = true;
                task.reviewStatus = 'approved';
                task.reviewComment = commentAnswer.comment;
                task.reviewedAt = new Date().toISOString();
                addTask(task);
                approved++;
              } else if (action.choice === 'reject') {
                const commentAnswer = await inquirer.prompt([
                  {
                    type: 'input',
                    name: 'comment',
                    message: '拒绝原因:',
                    default: '',
                  },
                ]);
                task.reviewed = true;
                task.reviewStatus = 'rejected';
                task.reviewComment = commentAnswer.comment;
                task.reviewedAt = new Date().toISOString();
                addTask(task);
                rejected++;
              } else if (action.choice === 'view') {
                console.log('\n' + task.output + '\n');
                i--;
              } else if (action.choice === 'skip') {
                skipped++;
              } else if (action.choice === 'reject-rest') {
                for (let j = i; j < failQcTasks.length; j++) {
                  const t = failQcTasks[j];
                  if (t.reviewStatus === 'rejected') continue;
                  t.reviewed = true;
                  t.reviewStatus = 'rejected';
                  t.reviewComment = '批量拒绝';
                  t.reviewedAt = new Date().toISOString();
                  addTask(t);
                  rejected++;
                }
                break;
              } else if (action.choice === 'exit') {
                break;
              }
            }
          }
        } else {
          console.log(chalk.gray('  （默认跳过，使用 --include-failed 可包含）\n'));
          skipped += failQcTasks.length;
        }
      }

      if (failedTasks.length > 0) {
        console.log(chalk.bold.gray(`⏹  执行失败 (${failedTasks.length} 条)`));
        console.log(chalk.gray('  执行失败的任务暂不审核，可使用 retry-failed 重试\n'));
        skipped += failedTasks.length;
      }

      console.log(chalk.cyan('\n─── 审核统计 ───'));
      console.log(chalk.green(`批准: ${approved}`));
      console.log(chalk.red(`拒绝: ${rejected}`));
      console.log(chalk.gray(`跳过: ${skipped}`));
      console.log(chalk.gray(`总计: ${tasks.length} 个任务`));
      console.log('');
    });

  reviewCmd
    .command('quality <taskId>')
    .description('对任务结果进行质检')
    .option('--fix', '尝试自动修复问题')
    .action(async (taskId, options) => {
      const config = loadConfig();
      const task = getTask(taskId);

      if (!task) {
        console.log(chalk.red(`✗ 任务不存在: ${taskId}`));
        return;
      }

      console.log(chalk.bold.cyan('\n🔍 质量检测\n'));

      const qualityCheck = checkQuality(task.output, config);
      task.qualityCheck = qualityCheck;
      addTask(task);

      displayQualityResult(qualityCheck);

      if (options.fix && qualityCheck.hasSensitiveWords) {
        console.log(chalk.cyan('\n尝试自动修复敏感词...'));
        const spinner = ora('正在生成修复版本...').start();

        try {
          const result = await callAIWithRetry({
            systemPrompt: '你是一名内容审核编辑，请将以下文本中的敏感词汇替换为合适的表达方式，保持原意不变。',
            userPrompt: `请替换以下文本中的敏感词（${qualityCheck.sensitiveWords.join('、')}），保持原意不变：\n\n${task.output}`,
          }, config, config.maxRetries);

          if (!task.versions) task.versions = [];
          task.versions.push({
            version: task.versions.length + 1,
            output: result.content,
            createdAt: new Date().toISOString(),
            tokens: result.tokens,
          });

          task.output = result.content;
          task.qualityCheck = checkQuality(result.content, config);
          addTask(task);

          spinner.succeed('已生成修复版本');
          console.log(chalk.green('\n修复后的内容:'));
          console.log(result.content);
        } catch (error: any) {
          spinner.fail('修复失败');
          console.log(chalk.red(error.message));
        }
      }
    });

  reviewCmd
    .command('compare <taskId>')
    .description('对比任务的多个版本')
    .action((taskId) => {
      const task = getTask(taskId);
      if (!task) {
        console.log(chalk.red(`✗ 任务不存在: ${taskId}`));
        return;
      }

      if (!task.versions || task.versions.length === 0) {
        console.log(chalk.yellow('该任务没有多个版本可供对比'));
        return;
      }

      console.log(chalk.bold.cyan(`\n📊 多版本对比: ${task.taskName}\n`));

      const allVersions = [
        { version: 0, output: task.output, createdAt: task.completedAt || task.createdAt, label: '当前版本' },
        ...task.versions.map((v, i) => ({
          version: v.version,
          output: v.output,
          createdAt: v.createdAt,
          label: `版本 v${v.version}`,
        })),
      ];

      for (const v of allVersions) {
        console.log(chalk.cyan(`--- ${v.label} (${formatDate(v.createdAt)}) ---`));
        console.log(v.output.substring(0, 200) + (v.output.length > 200 ? '...' : ''));
        console.log(chalk.gray(`长度: ${v.output.length} 字\n`));
      }

      console.log(chalk.gray('使用 aict review task <id> 可以切换版本或进行更多操作'));
    });

  reviewCmd
    .command('pending')
    .description('列出待审核的任务')
    .option('-n, --limit <number>', '显示数量', parseInt)
    .action((options) => {
      const history = loadHistory();
      const pendingTasks = history.tasks
        .filter(t => t.status === 'success' && !t.reviewed)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const limit = options.limit || 20;
      const displayTasks = pendingTasks.slice(0, limit);

      if (displayTasks.length === 0) {
        console.log(chalk.green('没有待审核的任务 🎉'));
        return;
      }

      const Table = require('cli-table3');
      const table = new Table({
        head: [chalk.cyan('任务ID'), chalk.cyan('名称'), chalk.cyan('模板'), chalk.cyan('质检'), chalk.cyan('创建时间')],
        colWidths: [15, 25, 20, 10, 20],
      });

      for (const task of displayTasks) {
        const qcStatus = task.qualityCheck ? (
          task.qualityCheck.overall === 'pass' ? chalk.green('通过') :
            task.qualityCheck.overall === 'warning' ? chalk.yellow('警告') : chalk.red('失败')
        ) : chalk.gray('未检');

        table.push([
          task.id.substr(0, 12) + '...',
          task.taskName.substr(0, 20),
          task.templateName.substr(0, 15),
          qcStatus,
          formatDate(task.createdAt),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.gray(`\n共 ${pendingTasks.length} 个待审核任务，显示前 ${displayTasks.length} 个`));
    });
}

function displayQualityResult(qc: any): void {
  console.log(chalk.cyan('\n=== 质检结果 ==='));

  const overallColor = qc.overall === 'pass' ? chalk.green :
    qc.overall === 'warning' ? chalk.yellow : chalk.red;
  console.log(`总体: ${overallColor(qc.overall.toUpperCase())}`);

  console.log(`\n敏感词检测: ${qc.hasSensitiveWords ? chalk.red('发现敏感词!') : chalk.green('无')}`);
  if (qc.hasSensitiveWords) {
    console.log(chalk.red(`  敏感词: ${qc.sensitiveWords.join(', ')}`));
  }

  console.log(`语气分析: ${qc.toneLabel} (${qc.toneScore.toFixed(2)})`);
  console.log(`可读性: ${qc.readabilityScore}/100`);

  const barLength = 20;
  const filled = Math.round((qc.readabilityScore / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  console.log(`  [${bar}] ${qc.readabilityScore}%`);
}

function formatQualityOverall(qc: any): string {
  if (!qc) return chalk.gray('未质检');
  if (qc.overall === 'pass') return chalk.green('通过');
  if (qc.overall === 'warning') return chalk.yellow('警告');
  return chalk.red('失败');
}

async function handleRewrite(task: TaskResult, config: any): Promise<void> {
  const toneChoice = await inquirer.prompt([
    {
      type: 'list',
      name: 'tone',
      message: '选择目标语气:',
      choices: [
        { name: '正式', value: 'formal' },
        { name: '轻松', value: 'casual' },
        { name: '专业', value: 'professional' },
        { name: '友好', value: 'friendly' },
      ],
    },
  ]);

  const spinner = ora('正在改写语气...').start();

  try {
    const result = await callAIWithRetry({
      systemPrompt: rewriteTonePrompt(toneChoice.tone),
      userPrompt: task.output,
    }, config, config.maxRetries);

    if (!task.versions) task.versions = [];
    task.versions.push({
      version: task.versions.length + 1,
      output: task.output,
      createdAt: new Date().toISOString(),
      tokens: task.tokens,
    });

    task.output = result.content;
    task.tokens = result.tokens;
    task.cost += result.cost;
    task.qualityCheck = checkQuality(result.content, config);
    addTask(task);

    spinner.succeed('语气改写完成');
    console.log(chalk.cyan('\n改写后的内容:'));
    console.log(result.content);
    console.log(chalk.gray(`\n新增成本: ${formatCost(result.cost)}`));

  } catch (error: any) {
    spinner.fail('改写失败');
    console.log(chalk.red(error.message));
  }
}

async function handleSummary(task: TaskResult, config: any): Promise<void> {
  const lengthChoice = await inquirer.prompt([
    {
      type: 'list',
      name: 'length',
      message: '选择摘要长度:',
      choices: [
        { name: '简短 (~100字)', value: 'short' },
        { name: '中等 (~300字)', value: 'medium' },
        { name: '详细 (~500字)', value: 'long' },
      ],
    },
  ]);

  const spinner = ora('正在生成摘要...').start();

  try {
    const result = await callAIWithRetry({
      systemPrompt: summaryPrompt(lengthChoice.length),
      userPrompt: task.output,
    }, config, config.maxRetries);

    spinner.succeed('摘要生成完成');
    console.log(chalk.cyan('\n生成的摘要:'));
    console.log(result.content);
    console.log(chalk.gray(`\n成本: ${formatCost(result.cost)}`));

    const saveSummary = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'save',
        message: '是否将摘要作为新版本保存？',
        default: false,
      },
    ]);

    if (saveSummary.save) {
      if (!task.versions) task.versions = [];
      task.versions.push({
        version: task.versions.length + 1,
        output: task.output,
        createdAt: new Date().toISOString(),
        tokens: task.tokens,
      });
      task.output = result.content;
      task.cost += result.cost;
      addTask(task);
      console.log(chalk.green('✓ 已保存为新版本'));
    }

  } catch (error: any) {
    spinner.fail('生成失败');
    console.log(chalk.red(error.message));
  }
}

async function handleNewVersion(task: TaskResult, config: any): Promise<void> {
  const instruction = await inquirer.prompt([
    {
      type: 'editor',
      name: 'prompt',
      message: '请输入修改要求:',
    },
  ]);

  const spinner = ora('正在生成新版本...').start();

  try {
    const result = await callAIWithRetry({
      systemPrompt: '请根据用户的要求修改以下内容，生成改进后的版本。',
      userPrompt: `修改要求: ${instruction.prompt}\n\n原始内容:\n${task.output}`,
    }, config, config.maxRetries);

    if (!task.versions) task.versions = [];
    task.versions.push({
      version: task.versions.length + 1,
      output: task.output,
      createdAt: new Date().toISOString(),
      tokens: task.tokens,
    });

    task.output = result.content;
    task.tokens = result.tokens;
    task.cost += result.cost;
    task.qualityCheck = checkQuality(result.content, config);
    addTask(task);

    spinner.succeed('新版本生成完成');
    console.log(chalk.cyan('\n新版本内容:'));
    console.log(result.content);

  } catch (error: any) {
    spinner.fail('生成失败');
    console.log(chalk.red(error.message));
  }
}
