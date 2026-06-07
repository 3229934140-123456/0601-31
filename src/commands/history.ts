import { Command } from 'commander';
const chalk = require('chalk');
const Table = require('cli-table3');
import { loadHistory, getTask, getBatch } from '../core/storage';
import { formatCost } from '../core/cost';
import { formatDate } from '../utils';

export function registerHistoryCommand(program: Command): void {
  const historyCmd = program
    .command('history')
    .description('查看历史记录和统计');

  historyCmd
    .command('list')
    .description('列出历史任务')
    .option('-n, --limit <number>', '显示数量', parseInt)
    .option('--type <type>', '任务类型: run|batch|review')
    .option('--status <status>', '按状态筛选')
    .action((options) => {
      const history = loadHistory();
      let tasks = [...history.tasks];

      if (options.status) {
        tasks = tasks.filter(t => t.status === options.status);
      }

      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const limit = options.limit || 20;
      const displayTasks = tasks.slice(0, limit);

      if (displayTasks.length === 0) {
        console.log(chalk.yellow('暂无历史记录'));
        return;
      }

      const table = new Table({
        head: [chalk.cyan('任务ID'), chalk.cyan('名称'), chalk.cyan('模板'), chalk.cyan('状态'), chalk.cyan('成本'), chalk.cyan('创建时间')],
        colWidths: [15, 20, 20, 10, 10, 20],
      });

      for (const task of displayTasks) {
        const statusColor = task.status === 'success' ? chalk.green :
          task.status === 'failed' ? chalk.red : chalk.yellow;

        table.push([
          task.id.substr(0, 12) + '...',
          task.taskName.substr(0, 15),
          task.templateName.substr(0, 15),
          statusColor(task.status),
          formatCost(task.cost),
          formatDate(task.createdAt),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.gray(`\n共 ${tasks.length} 条记录，显示前 ${displayTasks.length} 条`));
    });

  historyCmd
    .command('stats')
    .description('查看统计信息')
    .option('--days <days>', '统计最近N天', parseInt)
    .action((options) => {
      const history = loadHistory();
      const tasks = history.tasks;
      const batches = history.batches;

      let filteredTasks = tasks;
      if (options.days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - options.days);
        filteredTasks = tasks.filter(t => new Date(t.createdAt) >= cutoff);
      }

      const totalTasks = filteredTasks.length;
      const successTasks = filteredTasks.filter(t => t.status === 'success').length;
      const failedTasks = filteredTasks.filter(t => t.status === 'failed').length;
      const totalCost = filteredTasks.reduce((sum, t) => sum + t.cost, 0);
      const totalTokens = filteredTasks.reduce((sum, t) => sum + t.tokens.total, 0);
      const inputTokens = filteredTasks.reduce((sum, t) => sum + t.tokens.input, 0);
      const outputTokens = filteredTasks.reduce((sum, t) => sum + t.tokens.output, 0);

      const reviewedTasks = filteredTasks.filter(t => t.reviewed).length;
      const approvedTasks = filteredTasks.filter(t => t.reviewStatus === 'approved').length;
      const rejectedTasks = filteredTasks.filter(t => t.reviewStatus === 'rejected').length;

      console.log(chalk.bold.cyan('\n📊 使用统计\n'));

      const table = new Table({
        head: [chalk.cyan('指标'), chalk.cyan('数值')],
        colWidths: [25, 30],
      });

      table.push(['总任务数', String(totalTasks)]);
      table.push(['成功任务', chalk.green(String(successTasks))]);
      table.push(['失败任务', chalk.red(String(failedTasks))]);
      table.push(['成功率', `${totalTasks > 0 ? ((successTasks / totalTasks) * 100).toFixed(1) : 0}%`]);
      table.push(['总成本', formatCost(totalCost)]);
      table.push(['总 Token 数', String(totalTokens)]);
      table.push(['  输入 Token', String(inputTokens)]);
      table.push(['  输出 Token', String(outputTokens)]);
      table.push(['批量任务数', String(batches.length)]);
      table.push(['已审核任务', String(reviewedTasks)]);
      table.push(['  已批准', chalk.green(String(approvedTasks))]);
      table.push(['  已拒绝', chalk.red(String(rejectedTasks))]);

      console.log(table.toString());
      console.log('');

      const templateStats: Record<string, { count: number; cost: number }> = {};
      for (const task of filteredTasks) {
        if (!templateStats[task.templateName]) {
          templateStats[task.templateName] = { count: 0, cost: 0 };
        }
        templateStats[task.templateName].count++;
        templateStats[task.templateName].cost += task.cost;
      }

      if (Object.keys(templateStats).length > 0) {
        console.log(chalk.cyan('按模板统计:\n'));
        const tplTable = new Table({
          head: [chalk.cyan('模板'), chalk.cyan('任务数'), chalk.cyan('成本')],
          colWidths: [25, 15, 15],
        });

        const sortedTemplates = Object.entries(templateStats)
          .sort((a, b) => b[1].count - a[1].count);

        for (const [name, stats] of sortedTemplates) {
          tplTable.push([name, String(stats.count), formatCost(stats.cost)]);
        }

        console.log(tplTable.toString());
        console.log('');
      }
    });

  historyCmd
    .command('cost')
    .description('成本分析')
    .option('--days <days>', '统计最近N天', parseInt)
    .option('--by-day', '按天统计')
    .option('--by-template', '按模板统计')
    .action((options) => {
      const history = loadHistory();
      let tasks = [...history.tasks];

      if (options.days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - options.days);
        tasks = tasks.filter(t => new Date(t.createdAt) >= cutoff);
      }

      const totalCost = tasks.reduce((sum, t) => sum + t.cost, 0);
      const totalTokens = tasks.reduce((sum, t) => sum + t.tokens.total, 0);

      console.log(chalk.bold.cyan('\n💰 成本分析\n'));
      console.log(chalk.cyan(`总花费: ${chalk.bold(formatCost(totalCost))}`));
      console.log(chalk.cyan(`总 Token: ${totalTokens}`));
      console.log(chalk.cyan(`任务数: ${tasks.length}`));
      console.log(chalk.gray(`平均每任务成本: ${formatCost(totalCost / (tasks.length || 1))}`));
      console.log('');

      if (options.byDay) {
        const dailyStats: Record<string, { cost: number; count: number }> = {};

        for (const task of tasks) {
          const day = task.createdAt.substring(0, 10);
          if (!dailyStats[day]) {
            dailyStats[day] = { cost: 0, count: 0 };
          }
          dailyStats[day].cost += task.cost;
          dailyStats[day].count++;
        }

        console.log(chalk.cyan('按天统计:\n'));
        const table = new Table({
          head: [chalk.cyan('日期'), chalk.cyan('任务数'), chalk.cyan('成本')],
          colWidths: [15, 10, 15],
        });

        const sortedDays = Object.keys(dailyStats).sort();
        for (const day of sortedDays) {
          table.push([day, String(dailyStats[day].count), formatCost(dailyStats[day].cost)]);
        }

        console.log(table.toString());
        console.log('');
      }

      if (options.byTemplate) {
        const tplStats: Record<string, { cost: number; count: number; tokens: number }> = {};

        for (const task of tasks) {
          const name = task.templateName || '未知';
          if (!tplStats[name]) {
            tplStats[name] = { cost: 0, count: 0, tokens: 0 };
          }
          tplStats[name].cost += task.cost;
          tplStats[name].count++;
          tplStats[name].tokens += task.tokens.total;
        }

        console.log(chalk.cyan('按模板统计:\n'));
        const table = new Table({
          head: [chalk.cyan('模板'), chalk.cyan('任务数'), chalk.cyan('成本'), chalk.cyan('占比')],
          colWidths: [25, 10, 12, 10],
        });

        const sorted = Object.entries(tplStats).sort((a, b) => b[1].cost - a[1].cost);
        for (const [name, stats] of sorted) {
          const percentage = totalCost > 0 ? ((stats.cost / totalCost) * 100).toFixed(1) + '%' : '0%';
          table.push([name, String(stats.count), formatCost(stats.cost), percentage]);
        }

        console.log(table.toString());
        console.log('');
      }
    });

  historyCmd
    .command('replay <taskId>')
    .description('历史回放 - 查看任务详情')
    .option('--output-only', '只显示输出内容')
    .action((taskId, options) => {
      const task = getTask(taskId);
      if (!task) {
        console.log(chalk.red(`✗ 任务不存在: ${taskId}`));
        return;
      }

      if (options.outputOnly) {
        console.log(task.output);
        return;
      }

      console.log(chalk.bold.cyan(`\n🔄 历史回放: ${task.taskName}\n`));
      console.log(chalk.cyan('任务ID: ') + task.id);
      console.log(chalk.cyan('模板: ') + task.templateName);
      console.log(chalk.cyan('状态: ') + (task.status === 'success' ? chalk.green('成功') : chalk.red('失败')));
      console.log(chalk.cyan('创建时间: ') + formatDate(task.createdAt));
      if (task.completedAt) {
        console.log(chalk.cyan('完成时间: ') + formatDate(task.completedAt));
      }
      console.log(chalk.cyan('模型: ') + task.model);
      console.log(chalk.cyan('成本: ') + formatCost(task.cost));
      console.log(chalk.cyan('Token: ') + `${task.tokens.total} (in: ${task.tokens.input}, out: ${task.tokens.output})`);
      console.log('');

      console.log(chalk.cyan('输入变量:'));
      console.log(JSON.stringify(task.input, null, 2));
      console.log('');

      console.log(chalk.cyan('输出内容:'));
      console.log(task.output);

      if (task.qualityCheck) {
        console.log(chalk.cyan('\n质检结果:'));
        const qc = task.qualityCheck;
        console.log(`  总体: ${qc.overall}`);
        console.log(`  敏感词: ${qc.hasSensitiveWords ? qc.sensitiveWords.join(', ') : '无'}`);
        console.log(`  语气: ${qc.toneLabel} (${qc.toneScore.toFixed(2)})`);
        console.log(`  可读性: ${qc.readabilityScore}/100`);
      }

      if (task.versions && task.versions.length > 0) {
        console.log(chalk.cyan(`\n历史版本: ${task.versions.length} 个`));
      }

      console.log('');
    });

  historyCmd
    .command('estimate')
    .description('成本估算工具')
    .option('-i, --input-tokens <tokens>', '输入 Token 数', parseInt)
    .option('-o, --output-tokens <tokens>', '输出 Token 数', parseInt)
    .option('-t, --text <text>', '根据文本估算')
    .option('-n, --num-tasks <num>', '任务数量', parseInt)
    .action((options) => {
      const { loadConfig } = require('../core/config');
      const config = loadConfig();
      const { estimateTokens, calculateCost, formatCost } = require('../core/cost');

      let inputTokens = options.inputTokens || 0;
      let outputTokens = options.outputTokens || 500;
      const numTasks = options.numTasks || 1;

      if (options.text) {
        inputTokens = estimateTokens(options.text);
      }

      const costPerTask = calculateCost(inputTokens, outputTokens, config);
      const totalCost = costPerTask * numTasks;

      console.log(chalk.bold.cyan('\n🧮 成本估算\n'));
      console.log(chalk.cyan(`输入 Token: ${inputTokens}`));
      console.log(chalk.cyan(`输出 Token: ${outputTokens}`));
      console.log(chalk.cyan(`每任务成本: ${formatCost(costPerTask)}`));
      console.log(chalk.cyan(`任务数量: ${numTasks}`));
      console.log(chalk.bold.green(`\n预估总成本: ${formatCost(totalCost)}`));
      console.log(chalk.gray(`\n* 实际成本可能因实际输出 Token 数而有所不同`));
      console.log('');
    });
}
