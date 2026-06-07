import * as fs from 'fs';
import * as path from 'path';
import { TaskResult, BatchJob, HistoryRecord, PromptTemplate, ReviewLogEntry, ExportPreset } from '../types';
import { loadConfig } from './config';

export function getHistoryPath(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd);
  return path.join(cwd, config.historyFile);
}

export interface HistoryData {
  tasks: TaskResult[];
  batches: BatchJob[];
  records: HistoryRecord[];
  reviewLogs: ReviewLogEntry[];
  exportPresets: ExportPreset[];
}

function emptyHistory(): HistoryData {
  return {
    tasks: [],
    batches: [],
    records: [],
    reviewLogs: [],
    exportPresets: [],
  };
}

function ensureHistoryStructure(data: any): HistoryData {
  return {
    tasks: data.tasks || [],
    batches: data.batches || [],
    records: data.records || [],
    reviewLogs: data.reviewLogs || [],
    exportPresets: data.exportPresets || [],
  };
}

export function loadHistory(cwd: string = process.cwd()): HistoryData {
  const historyPath = getHistoryPath(cwd);
  if (!fs.existsSync(historyPath)) {
    return emptyHistory();
  }
  try {
    const content = fs.readFileSync(historyPath, 'utf-8');
    const data = JSON.parse(content);
    return ensureHistoryStructure(data);
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

export function addReviewLog(log: ReviewLogEntry, cwd: string = process.cwd()): void {
  const history = loadHistory(cwd);
  history.reviewLogs.push(log);
  saveHistory(history, cwd);
}

export function getReviewLogs(options?: {
  taskId?: string;
  batchId?: string;
  limit?: number;
}, cwd: string = process.cwd()): ReviewLogEntry[] {
  const history = loadHistory(cwd);
  let logs = [...history.reviewLogs];

  if (options?.taskId) {
    logs = logs.filter(l => l.taskId === options.taskId);
  }
  if (options?.batchId) {
    logs = logs.filter(l => l.batchId === options.batchId);
  }

  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (options?.limit) {
    logs = logs.slice(0, options.limit);
  }

  return logs;
}

export function loadExportPresets(cwd: string = process.cwd()): ExportPreset[] {
  const history = loadHistory(cwd);
  return [...history.exportPresets].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function saveExportPreset(preset: ExportPreset, cwd: string = process.cwd()): void {
  const history = loadHistory(cwd);
  const existingIndex = history.exportPresets.findIndex(p => p.id === preset.id);
  if (existingIndex >= 0) {
    history.exportPresets[existingIndex] = preset;
  } else {
    history.exportPresets.push(preset);
  }
  saveHistory(history, cwd);
}

export function getExportPreset(idOrName: string, cwd: string = process.cwd()): ExportPreset | undefined {
  const presets = loadExportPresets(cwd);
  return presets.find(p => p.id === idOrName || p.name === idOrName);
}

export function deleteExportPreset(id: string, cwd: string = process.cwd()): boolean {
  const history = loadHistory(cwd);
  const index = history.exportPresets.findIndex(p => p.id === id);
  if (index >= 0) {
    history.exportPresets.splice(index, 1);
    saveHistory(history, cwd);
    return true;
  }
  return false;
}
