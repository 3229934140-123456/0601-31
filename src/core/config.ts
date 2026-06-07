import * as fs from 'fs';
import * as path from 'path';
import { AICTConfig } from '../types';

const CONFIG_FILE = '.aict-config.json';

const defaultConfig: AICTConfig = {
  projectName: 'ai-content-project',
  apiProvider: 'mock',
  defaultModel: 'gpt-3.5-turbo',
  outputDir: './output',
  templatesDir: './templates',
  historyFile: './.aict-history.json',
  sensitiveWords: ['违禁词1', '违禁词2', '敏感词'],
  defaultTone: 'professional',
  defaultSummaryLength: 'medium',
  maxRetries: 3,
  concurrency: 3,
  costPer1kTokens: {
    input: 0.0015,
    output: 0.002,
  },
};

export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, CONFIG_FILE);
}

export function loadConfig(cwd: string = process.cwd()): AICTConfig {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return { ...defaultConfig };
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    return { ...defaultConfig, ...config };
  } catch (error) {
    return { ...defaultConfig };
  }
}

export function saveConfig(config: Partial<AICTConfig>, cwd: string = process.cwd()): void {
  const configPath = getConfigPath(cwd);
  const currentConfig = loadConfig(cwd);
  const mergedConfig = { ...currentConfig, ...config };
  fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2), 'utf-8');
}

export function isInitialized(cwd: string = process.cwd()): boolean {
  return fs.existsSync(getConfigPath(cwd));
}

export function getDefaultConfig(): AICTConfig {
  return { ...defaultConfig };
}

export function ensureDirs(config: AICTConfig, cwd: string = process.cwd()): void {
  const dirs = [
    path.join(cwd, config.outputDir),
    path.join(cwd, config.templatesDir),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
