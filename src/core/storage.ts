import * as fs from 'fs';
import * as path from 'path';
import { TaskResult, BatchJob, HistoryRecord, PromptTemplate } from '../types';
import { loadConfig } from './config';

export function getHistoryPath(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd);
  return path.join(cwd, config.historyFile);
}

export interface HistoryData {
  tasks: TaskResult[];
  batches: BatchJob[];
  records: HistoryRecord[];
}

function emptyHistory(): HistoryData {
  return {
    tasks: [],
    batches: [],
    records: [],
  };
}

export function loadHistory(cwd: string = process.cwd()): HistoryData {
  const historyPath = getHistoryPath(cwd);
  if (!fs.existsSync(historyPath)) {
    return emptyHistory();
  }
  try {
    const content = fs.readFileSync(historyPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return emptyHistory();
  }
}

export function saveHistory(data: HistoryData, cwd: string = process.cwd()): void {
  const historyPath = getHistoryPath(cwd);
  fs.writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function addTask(task: TaskResult, cwd: string = process.cwd()): void {
  const history = loadHistory(cwd);
  const existingIndex = history.tasks.findIndex(t => t.id === task.id);
  if (existingIndex >= 0) {
    history.tasks[existingIndex] = task;
  } else {
    history.tasks.push(task);
  }

  for (const batch of history.batches) {
    const taskIndex = batch.tasks.findIndex(t => t.id === task.id);
    if (taskIndex >= 0) {
      batch.tasks[taskIndex] = task;
    }
  }

  saveHistory(history, cwd);
}

export function getTask(taskId: string, cwd: string = process.cwd()): TaskResult | undefined {
  const history = loadHistory(cwd);
  return history.tasks.find(t => t.id === taskId);
}

export function addBatch(batch: BatchJob, cwd: string = process.cwd()): void {
  const history = loadHistory(cwd);
  const existingIndex = history.batches.findIndex(b => b.id === batch.id);
  if (existingIndex >= 0) {
    history.batches[existingIndex] = batch;
  } else {
    history.batches.push(batch);
  }
  saveHistory(history, cwd);
}

export function getBatch(batchId: string, cwd: string = process.cwd()): BatchJob | undefined {
  const history = loadHistory(cwd);
  const batch = history.batches.find(b => b.id === batchId);
  if (!batch) return undefined;

  const updatedTasks = batch.tasks.map(task => {
    const latest = history.tasks.find(t => t.id === task.id);
    return latest || task;
  });

  return {
    ...batch,
    tasks: updatedTasks,
    completedTasks: updatedTasks.filter(t => t.status === 'success').length,
    failedTasks: updatedTasks.filter(t => t.status === 'failed').length,
  };
}

export function addHistoryRecord(record: HistoryRecord, cwd: string = process.cwd()): void {
  const history = loadHistory(cwd);
  history.records.unshift(record);
  saveHistory(history, cwd);
}

export function getTemplatesPath(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd);
  return path.join(cwd, config.templatesDir);
}

export function loadTemplates(cwd: string = process.cwd()): PromptTemplate[] {
  const templatesPath = getTemplatesPath(cwd);
  if (!fs.existsSync(templatesPath)) {
    return [];
  }
  const templates: PromptTemplate[] = [];
  const files = fs.readdirSync(templatesPath).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(templatesPath, file), 'utf-8');
      templates.push(JSON.parse(content));
    } catch (error) {
      // skip invalid files
    }
  }
  return templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function saveTemplate(template: PromptTemplate, cwd: string = process.cwd()): void {
  const templatesPath = getTemplatesPath(cwd);
  if (!fs.existsSync(templatesPath)) {
    fs.mkdirSync(templatesPath, { recursive: true });
  }
  const filePath = path.join(templatesPath, `${template.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8');
}

export function getTemplate(templateId: string, cwd: string = process.cwd()): PromptTemplate | undefined {
  const templates = loadTemplates(cwd);
  return templates.find(t => t.id === templateId);
}

export function deleteTemplate(templateId: string, cwd: string = process.cwd()): boolean {
  const templatesPath = getTemplatesPath(cwd);
  const filePath = path.join(templatesPath, `${templateId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export function getOutputDir(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd);
  return path.join(cwd, config.outputDir);
}

export function ensureOutputDir(cwd: string = process.cwd()): string {
  const outputDir = getOutputDir(cwd);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}
