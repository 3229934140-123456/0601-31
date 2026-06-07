import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
import * as fs from 'fs';
import * as path from 'path';
import { loadHistory, getBatch, ensureOutputDir, saveExportPreset, getExportPreset, loadExportPresets, deleteExportPreset } from '../core/storage';
import { formatCost } from '../core/cost';
import { formatDate, generateId } from '../utils';
import { ExportPreset } from '../types';

interface ExportField {
  id: string;
  label: string;
  category: string;
  default?: boolean;
}

const EXPORT_FIELDS: ExportField[] = [
  { id: 'id', label: '任务ID', category: '基础', default: true },
  { id: 'taskName', label: '任务名称', category: '基础', default: true },
  { id: 'templateName', label: '模板名称', category: '基础', default: true },
  { id: 'sourceFile', label: '来源文件', category: '基础', default: true },
  { id: 'status', label: '执行状态', category: '基础', default: true },
  { id: 'model', label: '模型', category: '基础', default: false },
  { id: 'createdAt', label: '创建时间', category: '基础', default: true },
  { id: 'completedAt', label: '完成时间', category: '基础', default: false },

  { id: 'input', label: '输入变量', category: '输入', default: false },
  { id: 'output', label: '输出内容', category: '输出', default: true },

  { id: 'reviewStatus', label: '审核状态', category: '审核', default: true },
  { id: 'reviewComment', label: '审核备注', category: '审核', default: true },

  { id: 'qc_overall', label: '质检结果', category: '质检', default: false },
  { id: 'qc_sensitiveWords', label: '敏感词检测', category: '质检', default: false },
  { id: 'qc_tone', label: '语气分析', category: '质检', default: false },
  { id: 'qc_readability', label: '可读性评分', category: '质检', default: false },

  { id: 'inputTokens', label: '输入Token', category: '成本', default: false },
  { id: 'outputTokens', label: '输出Token', category: '成本', default: false },
  { id: 'totalTokens', label: '总Token', category: '成本', default: false },
  { id: 'cost', label: '成本', category: '成本', default: true },
];

function getDefaultFieldIds(): string[] {
  return EXPORT_FIELDS.filter(f => f.default).map(f => f.id);
}

function buildRecords(tasks: any[], fieldIds: string[]): any[] {
  return tasks.map(task => {
    const record: any = {};
    for (const fieldId of fieldIds) {
      switch (fieldId) {
        case 'id':
          record.id = task.id;
          break;
        case 'taskName':
          record.taskName = task.taskName;
          break;
        case 'templateName':
          record.templateName = task.templateName;
          break;
        case 'sourceFile':
          record.sourceFile = task.sourceFile ? path.basename(task.sourceFile) : '';
          break;
        case 'status':
          record.status = task.status;
          break;
        case 'model':
          record.model = task.model;
          break;
        case 'createdAt':
          record.createdAt = task.createdAt;
          break;
        case 'completedAt':
          record.completedAt = task.completedAt || '';
          break;
        case 'input':
          record.input = task.input ? JSON.stringify(task.input) : '';
          break;
        case 'output':
          record.output = task.output || '';
          break;
        case 'reviewStatus':
          record.reviewStatus = task.reviewStatus || 'pending';
          break;
        case 'reviewComment':
          record.reviewComment = task.reviewComment || '';
          break;
        case 'qc_overall':
          record.qc_overall = task.qualityCheck?.overall || '';
          break;
        case 'qc_sensitiveWords':
          record.qc_sensitiveWords = task.qualityCheck?.sensitiveWords?.join('、') || '';
          break;
        case 'qc_tone':
          record.qc_tone = task.qualityCheck?.toneLabel || '';
          break;
        case 'qc_readability':
          record.qc_readability = task.qualityCheck?.readabilityScore || '';
          break;
        case 'inputTokens':
          record.inputTokens = task.tokens?.input || 0;
          break;
        case 'outputTokens':
          record.outputTokens = task.tokens?.output || 0;
          break;
        case 'totalTokens':
          record.totalTokens = task.tokens?.total || 0;
          break;
        case 'cost':
          record.cost = task.cost?.toFixed?.(6) ?? task.cost;
          break;
      }
    }
    return record;
  });
}

function fieldLabel(id: string): string {
  const f = EXPORT_FIELDS.find(f => f.id === id);
  return f ? f.label : id;
}

function generateOutputFileName(prefix: string, batchId: string | undefined, ext: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substr(0, 19);
  const batchPart = batchId ? `_${batchId}` : '';
  return `${prefix}${batchPart}_${timestamp}.${ext}`;
}

function printExportPreview(tasks: any[], fieldIds: string[]): void {
  const total = tasks.length;
  const successCount = tasks.filter(t => t.status === 'success').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;
  const approvedCount = tasks.filter(t => t.reviewStatus === 'approved').length;
  const rejectedCount = tasks.filter(t => t.reviewStatus === 'rejected').length;
  const pendingCount = total - approvedCount - rejectedCount;
  const totalCost = tasks.reduce((sum, t) => sum + (t.cost || 0), 0);

  console.log(chalk.cyan('\n📋 导出预览'));
  console.log(chalk.cyan('───────────────────────────'));
  console.log(`导出条数: ${chalk.bold(total)} 条`);
  console.log(`执行状态: ${chalk.green(`成功 ${successCount}`)} / ${chalk.red(`失败 ${failedCount}`)}`);
  console.log(`审核状态: ${chalk.green(`已通过 ${approvedCount}`)} / ${chalk.red(`已拒绝 ${rejectedCount}`)} / ${chalk.yellow(`待审核 ${pendingCount}`)}`);
  console.log(`总成本: ${formatCost(totalCost)}`);
  console.log(`导出字段: ${fieldIds.length} 个 (${fieldIds.map(fieldLabel).join(', ')})`);
  console.log('');
}

async function selectFieldsInteractive(defaultFields: string[]): Promise<string[]> {
  const categories = [...new Set(EXPORT_FIELDS.map(f => f.category))];

  const choices: any[] = categories.map(cat => ({
    name: chalk.cyan(`[${cat}] 全选`),
    value: `category:${cat}`,
  }));

  choices.push(new inquirer.Separator());

  for (const field of EXPORT_FIELDS) {
    choices.push({
      name: `  ${fieldLabel(field.id)}`,
      value: field.id,
      checked: defaultFields.includes(field.id),
    });
  }

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'fields',
      message: '选择要导出的字段:',
      choices,
      validate: (selected: string[]) => {
        if (selected.length === 0) return '至少选择一个字段';
        const realFields = selected.filter(s => !s.startsWith('category:'));
        if (realFields.length === 0) return '至少选择一个具体字段';
        return true;
      },
    },
  ]);

  let selected = [...answers.fields];

  for (const sel of answers.fields) {
    if (sel.startsWith('category:')) {
      const cat = sel.replace('category:', '');
      const catFields = EXPORT_FIELDS.filter(f => f.category === cat).map(f => f.id);
      selected = [...new Set([...selected, ...catFields])];
    }
  }

  selected = selected.filter(s => !s.startsWith('category:'));
  return selected;
}

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('导出结果和报表');

  exportCmd
    .command('csv')
    .description('导出为 CSV 格式')
    .option('-b, --batch <batchId>', '导出指定批量任务')
    .option('-o, --output <file>', '输出文件路径')
    .option('--fields <fields...>', '指定导出字段')
    .option('--select-fields', '交互式选择导出字段')
    .option('--preset <name>', '使用导出预设')
    .option('--only-approved', '只导出已审核通过的')
    .option('--only-pending', '只导出待审核的')
    .option('--only-success', '只导出执行成功的')
    .option('--only-failed', '只导出执行失败的')
    .option('-y, --yes', '非交互模式，直接导出')
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
      if (options.onlyPending) {
        tasks = tasks.filter(t => !t.reviewStatus || t.reviewStatus === 'pending');
      }
      if (options.onlySuccess) {
        tasks = tasks.filter(t => t.status === 'success');
      }
      if (options.onlyFailed) {
        tasks = tasks.filter(t => t.status === 'failed');
      }

      if (tasks.length === 0) {
        console.log(chalk.yellow('没有可导出的任务'));
        return;
      }

      let fieldIds: string[];
      if (options.preset) {
        const preset = getExportPreset(options.preset);
        if (!preset) {
          console.log(chalk.red(`✗ 导出预设不存在: ${options.preset}`));
          console.log(chalk.gray('可用预设:'));
          const presets = loadExportPresets();
          if (presets.length === 0) {
            console.log(chalk.gray('  (暂无预设，使用 export preset create 创建)'));
          } else {
            for (const p of presets) {
              console.log(chalk.gray(`  - ${p.name} (${p.fields.length} 个字段)`));
            }
          }
          return;
        }
        fieldIds = preset.fields;
        console.log(chalk.cyan(`使用预设: ${preset.name} (${fieldIds.length} 个字段)`));
      } else if (options.fields && options.fields.length > 0) {
        fieldIds = options.fields.filter((f: string) =>
          EXPORT_FIELDS.some(ef => ef.id === f)
        );
        if (fieldIds.length === 0) {
          console.log(chalk.red('✗ 没有有效的导出字段'));
          return;
        }
      } else if (options.selectFields) {
        fieldIds = await selectFieldsInteractive(getDefaultFieldIds());
      } else {
        fieldIds = getDefaultFieldIds();
      }

      printExportPreview(tasks, fieldIds);

      if (!options.yes && !options.selectFields) {
        const confirm = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: '确认导出？',
            default: true,
          },
        ]);
        if (!confirm.confirmed) {
          console.log(chalk.gray('已取消导出'));
          return;
        }
      }

      const outputFile = options.output || generateOutputFileName('export', options.batch, 'csv');

      const spinner = ora('正在导出...').start();

      try {
        const createCsvWriter = require('csv-writer').createObjectCsvWriter;

        const headers = fieldIds.map((id: string) => ({
          id,
          title: fieldLabel(id),
        }));

        const csvWriter = createCsvWriter({
          path: outputFile,
          header: headers,
        });

        const records = buildRecords(tasks, fieldIds);
        const safeRecords = records.map(r => {
          const safe: any = {};
          for (const key of Object.keys(r)) {
            safe[key] = typeof r[key] === 'string'
              ? r[key].replace(/\n/g, '\\n')
              : r[key];
          }
          return safe;
        });

        await csvWriter.writeRecords(safeRecords);

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
    .option('--fields <fields...>', '指定导出字段')
    .option('--select-fields', '交互式选择导出字段')
    .option('--preset <name>', '使用导出预设')
    .option('--only-approved', '只导出已审核通过的')
    .option('--only-pending', '只导出待审核的')
    .option('--only-success', '只导出执行成功的')
    .option('--only-failed', '只导出执行失败的')
    .option('-y, --yes', '非交互模式，直接导出')
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
      if (options.onlyPending) {
        tasks = tasks.filter(t => !t.reviewStatus || t.reviewStatus === 'pending');
      }
      if (options.onlySuccess) {
        tasks = tasks.filter(t => t.status === 'success');
      }
      if (options.onlyFailed) {
        tasks = tasks.filter(t => t.status === 'failed');
      }

      if (tasks.length === 0) {
        console.log(chalk.yellow('没有可导出的任务'));
        return;
      }

      let fieldIds: string[];
      if (options.preset) {
        const preset = getExportPreset(options.preset);
        if (!preset) {
          console.log(chalk.red(`✗ 导出预设不存在: ${options.preset}`));
          console.log(chalk.gray('可用预设:'));
          const presets = loadExportPresets();
          if (presets.length === 0) {
            console.log(chalk.gray('  (暂无预设，使用 export preset create 创建)'));
          } else {
            for (const p of presets) {
              console.log(chalk.gray(`  - ${p.name} (${p.fields.length} 个字段)`));
            }
          }
          return;
        }
        fieldIds = preset.fields;
        console.log(chalk.cyan(`使用预设: ${preset.name} (${fieldIds.length} 个字段)`));
      } else if (options.fields && options.fields.length > 0) {
        fieldIds = options.fields.filter((f: string) =>
          EXPORT_FIELDS.some(ef => ef.id === f)
        );
        if (fieldIds.length === 0) {
          console.log(chalk.red('✗ 没有有效的导出字段'));
          return;
        }
      } else if (options.selectFields) {
        fieldIds = await selectFieldsInteractive(getDefaultFieldIds());
      } else {
        fieldIds = getDefaultFieldIds();
      }

      printExportPreview(tasks, fieldIds);

      if (!options.yes && !options.selectFields) {
        const confirm = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: '确认导出？',
            default: true,
          },
        ]);
        if (!confirm.confirmed) {
          console.log(chalk.gray('已取消导出'));
          return;
        }
      }

      const outputFile = options.output || generateOutputFileName('export', options.batch, 'xlsx');
      const spinner = ora('正在导出 Excel...').start();

      try {
        const XLSX = require('xlsx');

        const records = buildRecords(tasks, fieldIds);
        const labeled = records.map(r => {
          const out: any = {};
          for (const key of Object.keys(r)) {
            out[fieldLabel(key)] = r[key];
          }
          return out;
        });

        const ws = XLSX.utils.json_to_sheet(labeled);
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
    .option('--only-approved', '只合并已审核通过的')
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
      if (options.onlyApproved) {
        tasks = tasks.filter(t => t.reviewStatus === 'approved');
      }

      if (tasks.length === 0) {
        console.log(chalk.yellow('没有可合并的任务'));
        return;
      }

      const outputFile = options.output || generateOutputFileName('merged', options.batch, 'txt');
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
      const reviewedCount = tasks.filter(t => t.reviewStatus && t.reviewStatus !== 'pending').length;
      const approvedCount = tasks.filter(t => t.reviewStatus === 'approved').length;
      const rejectedCount = tasks.filter(t => t.reviewStatus === 'rejected').length;

      const qualityPassed = tasks.filter(t => t.qualityCheck?.overall === 'pass').length;
      const qualityWarning = tasks.filter(t => t.qualityCheck?.overall === 'warning').length;
      const qualityFailed = tasks.filter(t => t.qualityCheck?.overall === 'fail').length;

      const outputFile = options.output || generateOutputFileName('report', options.batch, options.format);

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

  const presetCmd = exportCmd
    .command('preset')
    .description('导出预设管理');

  presetCmd
    .command('list')
    .description('列出所有导出预设')
    .action(() => {
      const presets = loadExportPresets();

      if (presets.length === 0) {
        console.log(chalk.yellow('暂无导出预设'));
        console.log(chalk.gray('使用 export preset create 创建预设'));
        return;
      }

      console.log(chalk.bold.cyan('\n📋 导出预设列表\n'));

      const Table = require('cli-table3');
      const table = new Table({
        head: [chalk.cyan('预设名称'), chalk.cyan('描述'), chalk.cyan('字段数'), chalk.cyan('更新时间')],
        colWidths: [20, 30, 10, 22],
      });

      for (const preset of presets) {
        table.push([
          preset.name,
          preset.description.substr(0, 25),
          preset.fields.length,
          formatDate(preset.updatedAt),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.gray(`\n共 ${presets.length} 个预设`));
      console.log('');
    });

  presetCmd
    .command('create')
    .description('创建新的导出预设')
    .option('-n, --name <name>', '预设名称')
    .option('-d, --desc <description>', '描述')
    .option('--fields <fields...>', '预设字段列表')
    .action(async (options) => {
      let name = options.name;
      let description = options.desc || '';
      let fieldIds = options.fields || [];

      if (!name) {
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: '预设名称:',
            validate: (val: string) => val.trim() !== '' || '名称不能为空',
          },
        ]);
        name = answer.name;
      }

      if (!description) {
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'description',
            message: '预设描述（可选）:',
          },
        ]);
        description = answer.description;
      }

      if (fieldIds.length === 0) {
        fieldIds = await selectFieldsInteractive(getDefaultFieldIds());
      }

      if (fieldIds.length === 0) {
        console.log(chalk.red('✗ 至少选择一个字段'));
        return;
      }

      const now = new Date().toISOString();
      const preset: ExportPreset = {
        id: generateId('preset'),
        name,
        description,
        fields: fieldIds,
        createdAt: now,
        updatedAt: now,
      };

      saveExportPreset(preset);
      console.log(chalk.green(`✓ 预设 "${name}" 创建成功`));
      console.log(chalk.gray(`包含 ${fieldIds.length} 个字段: ${fieldIds.join(', ')}`));
      console.log('');
    });

  presetCmd
    .command('view <name>')
    .description('查看预设详情')
    .action((name) => {
      const preset = getExportPreset(name);

      if (!preset) {
        console.log(chalk.red(`✗ 预设不存在: ${name}`));
        return;
      }

      console.log(chalk.bold.cyan(`\n📋 预设详情: ${preset.name}\n`));
      console.log(chalk.cyan('ID: ') + preset.id);
      console.log(chalk.cyan('描述: ') + (preset.description || '-'));
      console.log(chalk.cyan('字段数: ') + preset.fields.length);
      console.log(chalk.cyan('创建时间: ') + formatDate(preset.createdAt));
      console.log(chalk.cyan('更新时间: ') + formatDate(preset.updatedAt));
      console.log(chalk.cyan('\n字段列表:'));

      for (const fieldId of preset.fields) {
        const field = EXPORT_FIELDS.find(f => f.id === fieldId);
        if (field) {
          console.log(`  • ${field.label} (${field.category})`);
        }
      }
      console.log('');
    });

  presetCmd
    .command('delete <name>')
    .description('删除导出预设')
    .action(async (name) => {
      const preset = getExportPreset(name);
      if (!preset) {
        console.log(chalk.red(`✗ 预设不存在: ${name}`));
        return;
      }

      const confirm = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `确定删除预设 "${name}"？`,
          default: false,
        },
      ]);

      if (!confirm.confirmed) {
        console.log(chalk.gray('已取消删除'));
        return;
      }

      deleteExportPreset(preset.id);
      console.log(chalk.green(`✓ 预设 "${name}" 已删除`));
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
