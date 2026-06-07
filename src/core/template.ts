import * as fs from 'fs';
import * as path from 'path';
import { PromptTemplate, TemplateVariable } from '../types';

export function renderTemplate(template: string, variables: Record<string, any>): string {
  let result = template;
  result = result.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return variables[key] !== undefined ? String(variables[key]) : '';
  });
  return result;
}

export function extractVariables(userPrompt: string, systemPrompt?: string): string[] {
  const regex = /\{\{\s*(\w+)\s*\}\}/g;
  const variables: string[] = [];
  let match;

  while ((match = regex.exec(userPrompt)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  if (systemPrompt) {
    while ((match = regex.exec(systemPrompt)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }
  }

  return variables;
}

export function validateVariables(
  template: PromptTemplate,
  variables: Record<string, any>
): { valid: boolean; missing: string[]; errors: string[] } {
  const missing: string[] = [];
  const errors: string[] = [];

  for (const variable of template.variables) {
    const value = variables[variable.name];

    if (variable.required && (value === undefined || value === null || value === '')) {
      missing.push(variable.name);
    }

    if (value !== undefined && value !== null && value !== '') {
      switch (variable.type) {
        case 'number':
          if (isNaN(Number(value))) {
            errors.push(`变量 ${variable.name} 应该是数字类型`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
            errors.push(`变量 ${variable.name} 应该是布尔类型`);
          }
          break;
      }
    }
  }

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  };
}

export function generateTemplateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function createTemplate(options: {
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  variables?: TemplateVariable[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tone?: string;
  summaryLength?: string;
}): PromptTemplate {
  const now = new Date().toISOString();
  const extractedVars = extractVariables(options.userPrompt, options.systemPrompt);
  const existingVarNames = options.variables?.map(v => v.name) || [];
  const autoVars = extractedVars
    .filter(name => !existingVarNames.includes(name))
    .map(name => ({
      name,
      type: 'string' as const,
      description: `变量 ${name}`,
      required: true,
    }));

  return {
    id: generateTemplateId(),
    name: options.name,
    description: options.description,
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    variables: [...(options.variables || []), ...autoVars],
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    tone: options.tone,
    summaryLength: options.summaryLength,
    createdAt: now,
    updatedAt: now,
  };
}

export function refreshTemplateVariables(template: PromptTemplate): PromptTemplate {
  const extractedVarNames = extractVariables(template.userPrompt, template.systemPrompt);
  const existingVarsMap = new Map(template.variables.map(v => [v.name, v]));

  const newVariables: TemplateVariable[] = extractedVarNames.map(name => {
    if (existingVarsMap.has(name)) {
      return existingVarsMap.get(name)!;
    }
    return {
      name,
      type: 'string',
      description: `变量 ${name}`,
      required: true,
    };
  });

  return {
    ...template,
    variables: newVariables,
    updatedAt: new Date().toISOString(),
  };
}

export function loadTemplateFromFile(filePath: string): PromptTemplate | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (isValidTemplate(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isValidTemplate(obj: any): obj is PromptTemplate {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.userPrompt === 'string' &&
    Array.isArray(obj.variables)
  );
}
