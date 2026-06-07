import { AICallOptions, AICallResult, AICTConfig } from '../types';
import { calculateCost, estimateTokens } from './cost';

export async function callAI(options: AICallOptions, config: AICTConfig): Promise<AICallResult> {
  const {
    model = config.defaultModel,
    temperature = 0.7,
    maxTokens = 2000,
    systemPrompt,
    userPrompt,
    variables = {},
  } = options;

  const renderedPrompt = renderTemplate(userPrompt, variables);
  const renderedSystem = systemPrompt ? renderTemplate(systemPrompt, variables) : undefined;

  const inputTokens = estimateTokens(renderedPrompt) + (renderedSystem ? estimateTokens(renderedSystem) : 0);

  if (config.apiProvider === 'mock') {
    return mockCall(renderedPrompt, model, inputTokens, config);
  }

  if (config.apiProvider === 'openai') {
    return callOpenAI({
      model,
      temperature,
      maxTokens,
      systemPrompt: renderedSystem,
      userPrompt: renderedPrompt,
      inputTokens,
      config,
    });
  }

  if (config.apiProvider === 'anthropic') {
    return callAnthropic({
      model,
      temperature,
      maxTokens,
      systemPrompt: renderedSystem,
      userPrompt: renderedPrompt,
      inputTokens,
      config,
    });
  }

  return mockCall(renderedPrompt, model, inputTokens, config);
}

function renderTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return variables[key] !== undefined ? String(variables[key]) : '';
  });
}

async function mockCall(
  prompt: string,
  model: string,
  inputTokens: number,
  config: AICTConfig
): Promise<AICallResult> {
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

  const outputText = generateMockOutput(prompt);
  const outputTokens = estimateTokens(outputText);
  const totalTokens = inputTokens + outputTokens;
  const cost = calculateCost(inputTokens, outputTokens, config);

  return {
    content: outputText,
    model,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
    },
    cost,
  };
}

function generateMockOutput(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('摘要') || lowerPrompt.includes('summary')) {
    return `这是一段自动生成的摘要内容。\n\n本文主要讨论了人工智能在内容创作领域的应用，包括自动化文案生成、智能摘要提取和内容质量检测等方面。通过AI技术的应用，可以显著提高内容生产效率，降低人力成本，同时保证内容的一致性和质量水平。\n\n核心要点：\n1. AI可以辅助内容创作，提升效率\n2. 智能摘要能够快速提取关键信息\n3. 自动化质检确保内容合规性\n4. 多版本对比帮助选择最优方案`;
  }
  if (lowerPrompt.includes('改写') || lowerPrompt.includes('rewrite')) {
    return `这是经过语气改写后的内容版本。\n\n亲爱的用户，非常高兴能为您介绍我们的产品和服务。我们始终致力于为您提供最优质的体验，让每一次使用都充满惊喜。\n\n如果您有任何疑问或建议，欢迎随时与我们联系，我们将竭诚为您服务！`;
  }
  if (lowerPrompt.includes('质检') || lowerPrompt.includes('quality')) {
    return `质检结果报告\n\n=== 敏感词检测 ===\n未检测到敏感词汇。\n\n=== 语气分析 ===\n整体语气专业、正式，符合商务文档规范。\n\n=== 可读性评估 ===\n可读性评分：85/100\n建议：部分长句可以适当拆分，提升阅读体验。\n\n=== 总体评价 ===\n通过质检，可以发布。`;
  }
  return `这是AI生成的回复内容。\n\n针对您提出的问题，我进行了详细的分析和思考。以下是我的回答：\n\n首先，从整体来看，这个方案具有以下几个优势：\n1. 创新性强，采用了前沿的技术方案\n2. 实施路径清晰，分阶段推进风险可控\n3. 预期收益明确，ROI测算合理\n\n同时也需要注意以下几点：\n- 团队能力建设需要提前规划\n- 市场环境变化可能带来不确定性\n- 持续的迭代优化是成功的关键\n\n希望以上分析对您有所帮助。如有其他问题，欢迎继续交流。`;
}

interface CallAPIParams {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  userPrompt: string;
  inputTokens: number;
  config: AICTConfig;
}

async function callOpenAI(params: CallAPIParams): Promise<AICallResult> {
  const { model, temperature, maxTokens, systemPrompt, userPrompt, inputTokens, config } = params;

  if (!config.apiKey) {
    throw new Error('OpenAI API Key 未配置，请使用 aict init 进行配置');
  }

  const messages: any[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API 调用失败: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const outputTokens = data.usage?.completion_tokens || estimateTokens(content);
    const totalTokens = data.usage?.total_tokens || inputTokens + outputTokens;
    const actualInputTokens = data.usage?.prompt_tokens || inputTokens;
    const cost = calculateCost(actualInputTokens, outputTokens, config);

    return {
      content,
      model,
      tokens: {
        input: actualInputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      cost,
    };
  } catch (error: any) {
    if (error.name === 'FetchError' || error.message.includes('fetch')) {
      throw new Error(`网络请求失败: ${error.message}`);
    }
    throw error;
  }
}

async function callAnthropic(params: CallAPIParams): Promise<AICallResult> {
  const { model, temperature, maxTokens, systemPrompt, userPrompt, inputTokens, config } = params;

  if (!config.apiKey) {
    throw new Error('Anthropic API Key 未配置，请使用 aict init 进行配置');
  }

  const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';

  try {
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Anthropic API 调用失败: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data: any = await response.json();
    const content = data.content?.[0]?.text || '';
    const outputTokens = data.usage?.output_tokens || estimateTokens(content);
    const actualInputTokens = data.usage?.input_tokens || inputTokens;
    const totalTokens = actualInputTokens + outputTokens;
    const cost = calculateCost(actualInputTokens, outputTokens, config);

    return {
      content,
      model,
      tokens: {
        input: actualInputTokens,
        output: outputTokens,
        total: totalTokens,
      },
      cost,
    };
  } catch (error: any) {
    if (error.name === 'FetchError' || error.message.includes('fetch')) {
      throw new Error(`网络请求失败: ${error.message}`);
    }
    throw error;
  }
}

export async function callAIWithRetry(
  options: AICallOptions,
  config: AICTConfig,
  maxRetries: number = 3
): Promise<AICallResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callAI(options, config);
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('AI 调用失败');
}
