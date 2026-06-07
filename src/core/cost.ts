import { AICTConfig } from '../types';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = text.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
  return Math.round(chineseChars * 1.5 + englishWords * 1.3);
}

export function calculateCost(inputTokens: number, outputTokens: number, config: AICTConfig): number {
  const costPer1k = config.costPer1kTokens || { input: 0.0015, output: 0.002 };
  const inputCost = (inputTokens / 1000) * costPer1k.input;
  const outputCost = (outputTokens / 1000) * costPer1k.output;
  return Math.round((inputCost + outputCost) * 10000) / 10000;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `¥${(cost * 100).toFixed(2)}分`;
  }
  return `¥${cost.toFixed(4)}`;
}

export function estimateTaskCost(
  prompt: string,
  variables: Record<string, any>,
  config: AICTConfig,
  estimatedOutputTokens: number = 500
): number {
  const renderedPrompt = prompt.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return variables[key] !== undefined ? String(variables[key]) : '';
  });
  const inputTokens = estimateTokens(renderedPrompt);
  return calculateCost(inputTokens, estimatedOutputTokens, config);
}

export function estimateBatchCost(
  prompts: string[],
  config: AICTConfig,
  estimatedOutputTokens: number = 500
): { totalCost: number; totalInputTokens: number; totalOutputTokens: number } {
  let totalInputTokens = 0;
  for (const prompt of prompts) {
    totalInputTokens += estimateTokens(prompt);
  }
  const totalOutputTokens = estimatedOutputTokens * prompts.length;
  const totalCost = calculateCost(totalInputTokens, totalOutputTokens, config);
  return { totalCost, totalInputTokens, totalOutputTokens };
}
