import { Command } from 'commander';
const inquirer = require('inquirer');
const chalk = require('chalk');
const Table = require('cli-table3');
import { loadTemplates, saveTemplate, getTemplate, deleteTemplate } from '../core/storage';
import { createTemplate, validateVariables, renderTemplate, refreshTemplateVariables } from '../core/template';
import { PromptTemplate, TemplateVariable } from '../types';
import { truncateText, formatDate } from '../utils';

export function registerPromptCommand(program: Command): void {
  const promptCmd = program
    .command('prompt')
    .description('提示词模板管理');

  promptCmd
    .command('list')
    .description('列出所有模板')
    .action(() => {
      const templates = loadTemplates();
      if (templates.length === 0) {
        console.log(chalk.yellow('暂无模板，使用 aict prompt create 创建一个'));
        return;
      }

      const table = new Table({
        head: [chalk.cyan('ID'), chalk.cyan('名称'), chalk.cyan('描述'), chalk.cyan('变量数'), chalk.cyan('更新时间')],
        colWidths: [15, 20, 30, 10, 20],
      });

      for (const tpl of templates) {
        table.push([
          tpl.id.substr(0, 12) + '...',
          tpl.name,
          truncateText(tpl.description, 25),
          String(tpl.variables.length),
          formatDate(tpl.updatedAt),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.gray(`\n共 ${templates.length} 个模板`));
    });

  promptCmd
    .command('create')
    .description('创建新模板')
    .option('-n, --name <name>', '模板名称')
    .option('-d, --description <description>', '模板描述')
    .option('-s, --system <systemPrompt>', '系统提示词')
    .option('-u, --user <userPrompt>', '用户提示词（使用 {{变量名}} 定义变量）')
    .option('-m, --model <model>', '使用的模型')
    .option('-t, --temperature <temperature>', '温度参数', parseFloat)
    .option('--max-tokens <maxTokens>', '最大 token 数', parseInt)
    .option('--tone <tone>', '语气风格')
    .option('--summary-length <length>', '摘要长度')
    .action(async (options) => {
      if (options.name && options.user) {
        const template = createTemplate({
          name: options.name,
          description: options.description || '',
          systemPrompt: options.system || '',
          userPrompt: options.user,
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          tone: options.tone,
          summaryLength: options.summaryLength,
        });
        saveTemplate(template);
        console.log(chalk.green(`✓ 模板创建成功: ${template.name} (${template.id})`));
        return;
      }

      console.log(chalk.bold.cyan('📝 创建新模板\n'));

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: '模板名称:',
          validate: (input: string) => input.trim().length > 0 || '请输入模板名称',
        },
        {
          type: 'input',
          name: 'description',
          message: '模板描述:',
        },
        {
          type: 'editor',
          name: 'systemPrompt',
          message: '系统提示词 (System Prompt):',
          default: '',
        },
        {
          type: 'editor',
          name: 'userPrompt',
          message: '用户提示词 (User Prompt)，使用 {{变量名}} 定义变量:',
          validate: (input: string) => input.trim().length > 0 || '请输入用户提示词',
        },
        {
          type: 'input',
          name: 'model',
          message: '模型 (留空使用默认):',
        },
        {
          type: 'number',
          name: 'temperature',
          message: 'Temperature (0-2):',
          default: 0.7,
        },
        {
          type: 'number',
          name: 'maxTokens',
          message: '最大 Token 数:',
          default: 2000,
        },
      ]);

      const template = createTemplate({
        name: answers.name,
        description: answers.description,
        systemPrompt: answers.systemPrompt,
        userPrompt: answers.userPrompt,
        model: answers.model || undefined,
        temperature: answers.temperature,
        maxTokens: answers.maxTokens,
      });

      saveTemplate(template);

      console.log('\n' + chalk.green('✓ 模板创建成功！'));
      console.log(chalk.cyan(`\n模板名称: ${template.name}`));
      console.log(chalk.cyan(`模板ID: ${template.id}`));
      console.log(chalk.cyan(`检测到的变量 (${template.variables.length} 个):`));
      for (const v of template.variables) {
        console.log(chalk.gray(`  - ${v.name} (${v.type})`));
      }
    });

  promptCmd
    .command('view <templateId>')
    .description('查看模板详情')
    .action((templateId) => {
      const template = getTemplate(templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      console.log(chalk.bold.cyan(`\n📋 模板详情: ${template.name}\n`));
      console.log(chalk.cyan('ID: ') + template.id);
      console.log(chalk.cyan('描述: ') + template.description);
      console.log(chalk.cyan('创建时间: ') + formatDate(template.createdAt));
      console.log(chalk.cyan('更新时间: ') + formatDate(template.updatedAt));

      if (template.model) {
        console.log(chalk.cyan('模型: ') + template.model);
      }
      if (template.temperature !== undefined) {
        console.log(chalk.cyan('Temperature: ') + template.temperature);
      }
      if (template.maxTokens) {
        console.log(chalk.cyan('Max Tokens: ') + template.maxTokens);
      }

      console.log(chalk.cyan('\n变量列表:'));
      if (template.variables.length === 0) {
        console.log(chalk.gray('  无'));
      } else {
        for (const v of template.variables) {
          const reqTag = v.required ? chalk.red('*') : chalk.gray('o');
          console.log(`  ${reqTag} ${v.name} (${v.type}) - ${v.description}`);
        }
      }

      console.log(chalk.cyan('\n系统提示词:'));
      console.log(chalk.gray(template.systemPrompt || '  (空)'));

      console.log(chalk.cyan('\n用户提示词:'));
      console.log(chalk.white(template.userPrompt));
      console.log('');
    });

  promptCmd
    .command('edit <templateId>')
    .description('编辑模板')
    .action(async (templateId) => {
      const template = getTemplate(templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: '模板名称:',
          default: template.name,
        },
        {
          type: 'input',
          name: 'description',
          message: '模板描述:',
          default: template.description,
        },
        {
          type: 'editor',
          name: 'systemPrompt',
          message: '系统提示词:',
          default: template.systemPrompt,
        },
        {
          type: 'editor',
          name: 'userPrompt',
          message: '用户提示词:',
          default: template.userPrompt,
        },
        {
          type: 'input',
          name: 'model',
          message: '模型:',
          default: template.model || '',
        },
        {
          type: 'number',
          name: 'temperature',
          message: 'Temperature:',
          default: template.temperature || 0.7,
        },
        {
          type: 'number',
          name: 'maxTokens',
          message: 'Max Tokens:',
          default: template.maxTokens || 2000,
        },
      ]);

      const updatedTemplate: PromptTemplate = {
        ...template,
        name: answers.name,
        description: answers.description,
        systemPrompt: answers.systemPrompt,
        userPrompt: answers.userPrompt,
        model: answers.model || undefined,
        temperature: answers.temperature,
        maxTokens: answers.maxTokens,
        updatedAt: new Date().toISOString(),
      };

      const refreshedTemplate = refreshTemplateVariables(updatedTemplate);
      saveTemplate(refreshedTemplate);
      console.log(chalk.green('✓ 模板更新成功'));
      if (refreshedTemplate.variables.length !== template.variables.length) {
        console.log(chalk.cyan(`变量已更新: ${template.variables.length} → ${refreshedTemplate.variables.length} 个变量`));
        const added = refreshedTemplate.variables.filter(v => !template.variables.find(tv => tv.name === v.name));
        const removed = template.variables.filter(v => !refreshedTemplate.variables.find(rv => rv.name === v.name));
        if (added.length > 0) {
          console.log(chalk.green(`  新增: ${added.map(v => v.name).join(', ')}`));
        }
        if (removed.length > 0) {
          console.log(chalk.yellow(`  移除: ${removed.map(v => v.name).join(', ')}`));
        }
      }
    });

  promptCmd
    .command('delete <templateId>')
    .description('删除模板')
    .option('-f, --force', '强制删除，不确认')
    .action(async (templateId, options) => {
      const template = getTemplate(templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      if (!options.force) {
        const confirm = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: `确定要删除模板 "${template.name}" 吗？`,
            default: false,
          },
        ]);
        if (!confirm.confirmed) {
          console.log(chalk.gray('已取消删除'));
          return;
        }
      }

      const deleted = deleteTemplate(templateId);
      if (deleted) {
        console.log(chalk.green('✓ 模板删除成功'));
      } else {
        console.log(chalk.red('✗ 删除失败'));
      }
    });

  promptCmd
    .command('preview <templateId>')
    .description('预览模板渲染效果')
    .option('-v, --var <variables...>', '变量值，格式: 变量名=值')
    .action(async (templateId, options) => {
      const template = getTemplate(templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      let variables: Record<string, any> = {};

      if (options.var && options.var.length > 0) {
        for (const v of options.var) {
          const eqIndex = v.indexOf('=');
          if (eqIndex > 0) {
            const key = v.substring(0, eqIndex).trim();
            const value = v.substring(eqIndex + 1);
            variables[key] = value;
          }
        }
      } else if (template.variables.length > 0) {
        const questions = template.variables.map(v => ({
          type: v.type === 'text' ? 'editor' : 'input',
          name: v.name,
          message: `${v.name} (${v.description}):`,
          default: v.default,
        }));
        variables = await inquirer.prompt(questions as any);
      }

      const validation = validateVariables(template, variables);
      if (!validation.valid) {
        if (validation.missing.length > 0) {
          console.log(chalk.yellow(`缺少必填变量: ${validation.missing.join(', ')}`));
        }
        if (validation.errors.length > 0) {
          for (const err of validation.errors) {
            console.log(chalk.red(`  ✗ ${err}`));
          }
        }
        return;
      }

      console.log(chalk.bold.cyan('\n🎨 模板渲染预览\n'));

      if (template.systemPrompt) {
        console.log(chalk.cyan('系统提示词:'));
        console.log(chalk.gray(renderTemplate(template.systemPrompt, variables)));
        console.log('');
      }

      console.log(chalk.cyan('用户提示词:'));
      console.log(chalk.white(renderTemplate(template.userPrompt, variables)));
      console.log('');
    });

  promptCmd
    .command('duplicate <templateId>')
    .description('复制模板')
    .action((templateId) => {
      const template = getTemplate(templateId);
      if (!template) {
        console.log(chalk.red(`✗ 模板不存在: ${templateId}`));
        return;
      }

      const newTemplate: PromptTemplate = {
        ...template,
        id: `tpl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: `${template.name} (副本)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveTemplate(newTemplate);
      console.log(chalk.green(`✓ 模板已复制: ${newTemplate.name} (${newTemplate.id})`));
    });
}
