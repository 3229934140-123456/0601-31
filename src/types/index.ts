export interface AICTConfig {
  projectName: string;
  apiProvider: 'openai' | 'anthropic' | 'mock';
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  outputDir: string;
  templatesDir: string;
  historyFile: string;
  sensitiveWords: string[];
  defaultTone: 'formal' | 'casual' | 'professional' | 'friendly';
  defaultSummaryLength: 'short' | 'medium' | 'long';
  maxRetries: number;
  concurrency: number;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  variables: TemplateVariable[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tone?: string;
  summaryLength?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'text';
  description: string;
  required: boolean;
  default?: string | number | boolean;
}

export interface TaskResult {
  id: string;
  taskName: string;
  templateId: string;
  templateName: string;
  input: Record<string, any>;
  output: string;
  model: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
  status: 'success' | 'failed' | 'pending' | 'paused';
  error?: string;
  retryCount: number;
  createdAt: string;
  completedAt?: string;
  reviewed?: boolean;
  reviewStatus?: 'approved' | 'rejected' | 'pending';
  reviewNotes?: string;
  reviewComment?: string;
  reviewedAt?: string;
  qualityCheck?: QualityCheckResult;
  versions?: TaskResultVersion[];
  sourceFile?: string;
}

export interface TaskResultVersion {
  version: number;
  output: string;
  createdAt: string;
  tokens: {
    input: number;
    output: number;
  };
}

export interface QualityCheckResult {
  sensitiveWords: string[];
  hasSensitiveWords: boolean;
  toneScore: number;
  toneLabel: string;
  readabilityScore: number;
  overall: 'pass' | 'warning' | 'fail';
  issues?: string[];
}

export interface BatchJob {
  id: string;
  name: string;
  templateId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  tasks: TaskResult[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  inputDir?: string;
  outputDir?: string;
}

export interface HistoryRecord {
  id: string;
  type: 'run' | 'batch' | 'review';
  description: string;
  timestamp: string;
  totalCost: number;
  totalTokens: number;
  taskCount: number;
  successCount: number;
  failedCount: number;
}

export interface AICallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  userPrompt: string;
  variables?: Record<string, any>;
}

export interface AICallResult {
  content: string;
  model: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
}
