import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
import * as fs from 'fs';
import * as path from 'path';
import { loadHistory, getBatch, ensureOutputDir } from '../core/storage';
import { formatCost } from '../core/cost';
import { formatDate } from '../utils';

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('导出结果和报表');

  exportCmd
    .command('csv')
    .description('导出为 CSV 格式')
    .option('-b, --batch <batchId>', '导出指定批量任务')
    .option('-o, --output <file>', '输出文件路径')
    .option('--include-input', '包含输入内容')
    .option('--include-quality', '包含质检结果')
    .option('--only-approved', '只导出已审核通过的')
    .action(async (options) => {
      const history = loadHistory();
      let tasks = [...history.tasks];

      if (options.batch) {
        const batch = getBatch(options.batch);
        if (!batch) {
          console.log(chalk.red(`✗ 批量任务不存在: ${options.batch}`));
          return;
        }
        tasks = batch.tasks;
      }

      if (options.onlyApproved) {
        tasks = tasks.filter(t => t.reviewStatus === 'approved');
      }

      if (tasks.length === 0) {
        console.log(chalk.yellow('没有可导出的任务'));
        return;
      }

      const outputFile = options.output || `./export_${Date.now()}.csv`;

      const spinner = ora('正在导出...').start();

      try {
        const createCsvWriter = require('csv-writer').createObjectCsvWriter;

        const headers: any[] = [
          { id: 'id', title: '任务ID' },
          { id: 'taskName', title: '任务名称' },
          { id: 'templateName', title: '模板名称' },
          { id: 'status', title: '状态' },
          { id: 'model', title: '模型' },
          { id: 'inputTokens', title: '输入Token' },
          { id: 'outputTokens', title: '输出Token' },
          { id: 'totalTokens', title: '总Token' },
          { id: 'cost', title: '成本' },
          { id: 'createdAt', title: '创建时间' },
          { id: 'completedAt', title: '完成时间' },
          { id: 'reviewStatus', title: '审核状态' },
          { id: 'output', title: '输出内容' },
        ];

        if (options.includeInput) {
          headers.splice(3, 0, { id: 'input', title: '输入内容' });
        }

        if (options.includeQuality) {
          headers.push(
            { id: 'qc_overall', title: '质检结果' },
            { id: 'qc_sensitiveWords', title: '敏感词' },
            { id: 'qc_tone', title: '语气' },
            { id: 'qc_readability', title: '可读性' }
          );
        }

        const csvWriter = createCsvWriter({
          path: outputFile,
          header: headers,
        });

        const records = tasks.map(task => {
          const record: any = {
            id: task.id,
            taskName: task.taskName,
            templateName: task.templateName,
            status: task.status,
            model: task.model,
            inputTokens: task.tokens.input,
            outputTokens: task.tokens.output,
            totalTokens: task.tokens.total,
            cost: task.cost.toFixed(6),
            createdAt: task.createdAt,
            completedAt: task.completedAt || '',
            reviewStatus: task.reviewStatus || '',
            output: task.output.replace(/\n/g, '\\n'),
          };

          if (options.includeInput) {
            record.input = JSON.stringify(task.input).replace(/\n/g, '\\n');
          }

          if (options.includeQuality && task.qualityCheck) {
            record.qc_overall = task.qualityCheck.overall;
            record.qc_sensitiveWords = task.qualityCheck.sensitiveWords.join('、');
            record.qc_tone = task.qualityCheck.toneLabel;
            record.qc_readability = task.qualityCheck.readabilityScore;
          }

          return record;
        });

        await csvWriter.writeRecords(records);

        spinner.succeed(`导出成功: ${outputFile}`);
        console.log(chalk.gray(`共导出 ${tasks.length} 条记录`));

      } catch (error: any) {
        spinner.fail('导出失败');
        console.log(chalk.red(error.message));
      }
    });

  exportCmd
    .command('excel')
    .description('导出为 Excel 格式')
    .option('-b, --batch <batchId>', '导出指定批量任务')
    .option('-o, --output <file>', '输出文件路径')
    .option('--include-input', '包含输入内容')
    .option('--include-quality', '包含质检结果')
    .option('--only-approved', '只导出已审核通过的')
    .action((options) => {
      const history = loadHistory();
      let tasks = [...history.tasks];

      if (options.batch) {
        const batch = getBatch(options.batch);
        if (!batch) {
          console.log(chalk.red(`✗ 批量任务不存在: ${options.batch}`));
          return;
        }
        tasks = batch.tasks;
      }

      if (options.onlyApproved) {
        tasks = tasks.filter(t => t.reviewStatus === 'approved');
      }

      if (tasks.length === 0) {
        console.log(chalk.yellow('没有可导出的任务'));
        return;
      }

      const outputFile = options.output || `./export_${Date.now()}.xlsx`;
      const spinner = ora('正在导出 Excel...').start();

      try {
        const XLSX = require('xlsx');

        const data = tasks.map(task => {
          const row: any = {
            '任务ID': task.id,
            '任务名称': task.taskName,
            '模板名称': task.templateName,
            '状态': task.status,
            '模型': task.model,
            '输入Token': task.tokens.input,
            '输出Token': task.tokens.output,
            '总Token': task.tokens.total,
            '成本': task.cost,
            '创建时间': task.createdAt,
            '完成时间': task.completedAt || '',
            '审核状态': task.reviewStatus || '',
            '输出内容': task.output,
          };

          if (options.includeInput) {
            row['输入内容'] = JSON.stringify(task.input);
          }

          if (options.includeQuality && task.qualityCheck) {
            row['质检结果'] = task.qualityCheck.overall;
            row['敏感词'] = task.qualityCheck.sensitiveWords.join('、');
            row['语气'] = task.qualityCheck.toneLabel;
            row['可读性'] = task.qualityCheck.readabilityScore;
          }

          return row;
        });

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '任务结果');

        XLSX.writeFile(wb, outputFile);

        spinner.succeed(`导出成功: ${outputFile}`);
        console.log(chalk.gray(`共导出 ${tasks.length} 条记录`));

      } catch (error: any) {
        spinner.fail('导出失败');
        console.log(chalk.red(error.message));
      }
    });

  exportCmd
    .command('merge')
    .description('合并多个任务输出')
    .option('-b, --batch <batchId>', '合并指定批量任务的输出')
    .option('-o, --output <file>', '输出文件路径')
    .option('--separator <separator>', '分隔符', '\\n\\n---\\n\\n')
    .option('--add-filename', '添加文件名作为标题')
    .option('--only-success', '只合并成功的任务')
    .action((options) => {
      let tasks: any[] = [];

      if (options.batch) {
        const batch = getBatch(options.batch);
        if (!batch) {
          console.log(chalk.red(`✗ 批量任务不存在: ${options.batch}`));
          return;
        }
        tasks = batch.tasks;
      }

      if (options.onlySuccess) {
        tasks = tasks.filter(t => t.status === 'success');
      }

      if (tasks.length === 0) {
        console.log(chalk.yellow('没有可合并的任务'));
        return;
      }

      const outputFile = options.output || `./merged_output_${Date.now()}.txt`;
      const separator = options.separator.replace(/\\n/g, '\n');

      const spinner = ora('正在合并...').start();

      try {
        let mergedContent = '';

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];

          if (options.addFilename) {
            const title = task.sourceFile ? path.basename(task.sourceFile) : task.taskName;
            mergedContent += `## ${title}\n\n`;
          }

          mergedContent += task.output || '';

          if (i < tasks.length - 1) {
            mergedContent += separator;
          }
        }

        fs.writeFileSync(outputFile, mergedContent, 'utf-8');

        spinner.succeed(`合并完成: ${outputFile}`);
        console.log(chalk.gray(`共合并 ${tasks.length} 个任务`));
        console.log(chalk.gray(`文件大小: ${Buffer.byteLength(mergedContent, 'utf-8')} bytes`));

      } catch (error: any) {
        spinner.fail('合并失败');
        console.log(chalk.red(error.message));
      }
    });

  exportCmd
    .command('report')
    .description('生成项目报告')
    .option('-b, --batch <batchId>', '基于批量任务生成报告')
    .option('-o, --output <file>', '输出文件路径')
    .option('--format <format>', '报告格式: txt|md|html', 'txt')
    .action((options) => {
      const history = loadHistory();
      let tasks = [...history.tasks];
      let batches = [...history.batches];

      if (options.batch) {
        const batch = getBatch(options.batch);
        if (!batch) {
          console.log(chalk.red(`✗ 批量任务不存在: ${options.batch}`));
          return;
        }
        tasks = batch.tasks;
        batches = [batch];
      }

      const totalTasks = tasks.length;
      const successCount = tasks.filter(t => t.status === 'success').length;
      const failedCount = tasks.filter(t => t.status === 'failed').length;
      const totalCost = tasks.reduce((sum, t) => sum + t.cost, 0);
      const totalTokens = tasks.reduce((sum, t) => sum + t.tokens.total, 0);
      const reviewedCount = tasks.filter(t => t.reviewed).length;
      const approvedCount = tasks.filter(t => t.reviewStatus === 'approved').length;
      const rejectedCount = tasks.filter(t => t.reviewStatus === 'rejected').length;

      const qualityPassed = tasks.filter(t => t.qualityCheck?.overall === 'pass').length;
      const qualityWarning = tasks.filter(t => t.qualityCheck?.overall === 'warning').length;
      const qualityFailed = tasks.filter(t => t.qualityCheck?.overall === 'fail').length;

      const outputFile = options.output || `./report_${Date.now()}.${options.format}`;

      let reportContent = '';

      if (options.format === 'txt') {
        reportContent = generateTxtReport({
          totalTasks, successCount, failedCount, totalCost, totalTokens,
          reviewedCount, approvedCount, rejectedCount,
          qualityPassed, qualityWarning, qualityFailed,
          batchCount: batches.length,
        });
      } else if (options.format === 'md') {
        reportContent = generateMdReport({
          totalTasks, successCount, failedCount, totalCost, totalTokens,
          reviewedCount, approvedCount, rejectedCount,
          qualityPassed, qualityWarning, qualityFailed,
          batchCount: batches.length,
        });
      } else if (options.format === 'html') {
        reportContent = generateHtmlReport({
          totalTasks, successCount, failedCount, totalCost, totalTokens,
          reviewedCount, approvedCount, rejectedCount,
          qualityPassed, qualityWarning, qualityFailed,
          batchCount: batches.length,
        });
      }

      try {
        fs.writeFileSync(outputFile, reportContent, 'utf-8');
        console.log(chalk.green(`✓ 报告已生成: ${outputFile}`));
      } catch (error: any) {
        console.log(chalk.red(`生成失败: ${error.message}`));
      }
    });
}

function generateTxtReport(stats: any): string {
  return `
AI 内容处理 - 项目报告
${'='.repeat(40)}

生成时间: ${formatDate(new Date())}

【任务概览】
总任务数: ${stats.totalTasks}
成功: ${stats.successCount}
失败: ${stats.failedCount}
成功率: ${stats.totalTasks > 0 ? ((stats.successCount / stats.totalTasks) * 100).toFixed(1) : 0}%

【成本统计】
总成本: ${formatCost(stats.totalCost)}
总 Token: ${stats.totalTokens}

【审核统计】
已审核: ${stats.reviewedCount}
已批准: ${stats.approvedCount}
已拒绝: ${stats.rejectedCount}

【质检统计】
通过: ${stats.qualityPassed}
警告: ${stats.qualityWarning}
失败: ${stats.qualityFailed}

【批量任务】
批量任务数: ${stats.batchCount}

${'='.repeat(40)}
报告由 AI Content CLI 生成
`;
}

function generateMdReport(stats: any): string {
  return `# AI 内容处理 - 项目报告

> 生成时间: ${formatDate(new Date())}

## 任务概览

| 指标 | 数值 |
|------|------|
| 总任务数 | ${stats.totalTasks} |
| 成功 | ${stats.successCount} |
| 失败 | ${stats.failedCount} |
| 成功率 | ${stats.totalTasks > 0 ? ((stats.successCount / stats.totalTasks) * 100).toFixed(1) : 0}% |

## 成本统计

- **总成本**: ${formatCost(stats.totalCost)}
- **总 Token**: ${stats.totalTokens}

## 审核统计

| 状态 | 数量 |
|------|------|
| 已审核 | ${stats.reviewedCount} |
| 已批准 | ${stats.approvedCount} |
| 已拒绝 | ${stats.rejectedCount} |

## 质检统计

| 结果 | 数量 |
|------|------|
| 通过 | ${stats.qualityPassed} |
| 警告 | ${stats.qualityWarning} |
| 失败 | ${stats.qualityFailed} |

## 批量任务

共 **${stats.batchCount}** 个批量任务

---

*报告由 AI Content CLI 生成*
`;
}

function generateHtmlReport(stats: any): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>AI 内容处理 - 项目报告</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
  h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
  h2 { color: #34495e; margin-top: 30px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
  .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
  .stat-number { font-size: 32px; font-weight: bold; color: #2c3e50; }
  .stat-label { color: #7f8c8d; margin-top: 5px; }
  .success { color: #27ae60; }
  .failed { color: #e74c3c; }
  .warning { color: #f39c12; }
  table { width: 100%; border-collapse: collapse; margin: 15px 0; }
  th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #3498db; color: white; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #95a5a6; font-size: 14px; text-align: center; }
</style>
</head>
<body>

<h1>📊 AI 内容处理 - 项目报告</h1>
<p><strong>生成时间:</strong> ${formatDate(new Date())}</p>

<h2>📋 任务概览</h2>
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-number">${stats.totalTasks}</div>
    <div class="stat-label">总任务数</div>
  </div>
  <div class="stat-card">
    <div class="stat-number success">${stats.successCount}</div>
    <div class="stat-label">成功</div>
  </div>
  <div class="stat-card">
    <div class="stat-number failed">${stats.failedCount}</div>
    <div class="stat-label">失败</div>
  </div>
  <div class="stat-card">
    <div class="stat-number">${stats.totalTasks > 0 ? ((stats.successCount / stats.totalTasks) * 100).toFixed(1) : 0}%</div>
    <div class="stat-label">成功率</div>
  </div>
</div>

<h2>💰 成本统计</h2>
<table>
  <tr><th>指标</th><th>数值</th></tr>
  <tr><td>总成本</td><td><strong>${formatCost(stats.totalCost)}</strong></td></tr>
  <tr><td>总 Token 数</td><td>${stats.totalTokens}</td></tr>
</table>

<h2>✅ 审核统计</h2>
<table>
  <tr><th>状态</th><th>数量</th></tr>
  <tr><td>已审核</td><td>${stats.reviewedCount}</td></tr>
  <tr><td class="success">已批准</td><td class="success">${stats.approvedCount}</td></tr>
  <tr><td class="failed">已拒绝</td><td class="failed">${stats.rejectedCount}</td></tr>
</table>

<h2>🔍 质检统计</h2>
<table>
  <tr><th>结果</th><th>数量</th></tr>
  <tr><td class="success">通过</td><td class="success">${stats.qualityPassed}</td></tr>
  <tr><td class="warning">警告</td><td class="warning">${stats.qualityWarning}</td></tr>
  <tr><td class="failed">失败</td><td class="failed">${stats.qualityFailed}</td></tr>
</table>

<h2>📦 批量任务</h2>
<p>共 <strong>${stats.batchCount}</strong> 个批量任务</p>

<div class="footer">
  报告由 AI Content CLI 生成
</div>

</body>
</html>`;
}
