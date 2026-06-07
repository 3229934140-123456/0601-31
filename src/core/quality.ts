import { QualityCheckResult, AICTConfig } from '../types';

export function checkQuality(text: string, config: AICTConfig): QualityCheckResult {
  const sensitiveCheck = checkSensitiveWords(text, config.sensitiveWords);
  const toneCheck = analyzeTone(text, config.defaultTone);
  const readabilityCheck = calculateReadability(text);

  let overall: 'pass' | 'warning' | 'fail' = 'pass';
  if (sensitiveCheck.hasSensitiveWords) {
    overall = 'fail';
  } else if (toneCheck.score < 0.5 || readabilityCheck < 40) {
    overall = 'warning';
  }

  return {
    sensitiveWords: sensitiveCheck.foundWords,
    hasSensitiveWords: sensitiveCheck.hasSensitiveWords,
    toneScore: toneCheck.score,
    toneLabel: toneCheck.label,
    readabilityScore: readabilityCheck,
    overall,
  };
}

function checkSensitiveWords(text: string, sensitiveWords: string[]): { foundWords: string[]; hasSensitiveWords: boolean } {
  const foundWords: string[] = [];
  const lowerText = text.toLowerCase();

  for (const word of sensitiveWords) {
    if (lowerText.includes(word.toLowerCase())) {
      foundWords.push(word);
    }
  }

  return {
    foundWords,
    hasSensitiveWords: foundWords.length > 0,
  };
}

function analyzeTone(text: string, expectedTone: string): { score: number; label: string } {
  const lowerText = text.toLowerCase();
  const chineseText = text.match(/[\u4e00-\u9fa5]/g) || [];
  const chineseRatio = chineseText.length / (text.length || 1);

  let formalScore = 0;
  let casualScore = 0;
  let friendlyScore = 0;
  let professionalScore = 0;

  const formalPatterns = ['因此', '综上所述', '据此', '特此', '谨此', '敬启者', 'therefore', 'thus', 'hence', 'accordingly'];
  const casualPatterns = ['哈哈', '呢', '嘛', '啦', '哦', '嘿嘿', 'lol', 'haha', 'nice', 'cool'];
  const friendlyPatterns = ['您', '请', '谢谢', '感谢', '欢迎', '祝你', '希望', 'please', 'thank', 'welcome', 'dear'];
  const professionalPatterns = ['根据', '数据显示', '研究表明', '分析', '评估', '报告', 'analysis', 'research', 'according to', 'data shows'];

  for (const pattern of formalPatterns) {
    if (lowerText.includes(pattern.toLowerCase())) formalScore += 0.1;
  }
  for (const pattern of casualPatterns) {
    if (lowerText.includes(pattern.toLowerCase())) casualScore += 0.1;
  }
  for (const pattern of friendlyPatterns) {
    if (lowerText.includes(pattern.toLowerCase())) friendlyScore += 0.1;
  }
  for (const pattern of professionalPatterns) {
    if (lowerText.includes(pattern.toLowerCase())) professionalScore += 0.1;
  }

  const exclamationCount = (text.match(/[!！]/g) || []).length;
  const questionCount = (text.match(/[?？]/g) || []).length;

  if (exclamationCount > 3) casualScore += 0.2;
  if (questionCount > 5) friendlyScore += 0.1;

  const sentences = text.split(/[。！？.!?]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.length > 0
    ? text.length / sentences.length
    : 0;

  if (avgSentenceLength > 50) {
    formalScore += 0.2;
    professionalScore += 0.1;
  } else if (avgSentenceLength < 20) {
    casualScore += 0.2;
    friendlyScore += 0.1;
  }

  const scores: Record<string, number> = {
    formal: Math.min(1, formalScore + 0.3),
    casual: Math.min(1, casualScore + 0.2),
    friendly: Math.min(1, friendlyScore + 0.4),
    professional: Math.min(1, professionalScore + 0.3),
  };

  const targetScore = scores[expectedTone] || 0.5;
  const labels: Record<string, string> = {
    formal: '正式',
    casual: '轻松',
    friendly: '友好',
    professional: '专业',
  };

  const dominantTone = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  return {
    score: Math.min(1, targetScore),
    label: labels[dominantTone[0]] || dominantTone[0],
  };
}

function calculateReadability(text: string): number {
  if (!text || text.length === 0) return 0;

  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalChars = text.length;
  const chineseRatio = chineseChars / totalChars;

  const sentences = text.split(/[。！？.!?]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.length > 0
    ? text.length / sentences.length
    : 0;

  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const avgParagraphLength = paragraphs.length > 0
    ? text.length / paragraphs.length
    : text.length;

  let score = 100;

  if (chineseRatio > 0.5) {
    if (avgSentenceLength > 80) score -= 20;
    else if (avgSentenceLength > 60) score -= 10;
    else if (avgSentenceLength > 40) score -= 5;

    if (avgParagraphLength > 500) score -= 15;
    else if (avgParagraphLength > 300) score -= 10;
    else if (avgParagraphLength > 150) score -= 5;

    const complexChars = (text.match(/[\u9fa6-\u9fff]/g) || []).length;
    const complexRatio = complexChars / (chineseChars || 1);
    if (complexRatio > 0.1) score -= 10;
  } else {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const avgWordLength = words.length > 0
      ? text.replace(/\s+/g, '').length / words.length
      : 0;

    if (avgWordLength > 7) score -= 15;
    else if (avgWordLength > 6) score -= 10;
    else if (avgWordLength > 5) score -= 5;

    if (avgSentenceLength > 30) score -= 15;
    else if (avgSentenceLength > 25) score -= 10;
    else if (avgSentenceLength > 20) score -= 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function rewriteTonePrompt(targetTone: string): string {
  const tonePrompts: Record<string, string> = {
    formal: '请将以下内容改写为正式、严谨的语气，使用书面语，避免口语化表达。',
    casual: '请将以下内容改写为轻松、活泼的语气，可以适当使用口语化表达。',
    friendly: '请将以下内容改写为友好、亲切的语气，让读者感受到温暖和关怀。',
    professional: '请将以下内容改写为专业、权威的语气，使用行业术语，体现专业性。',
  };
  return tonePrompts[targetTone] || '请优化以下内容的表达方式。';
}

export function summaryPrompt(summaryLength: string): string {
  const lengthPrompts: Record<string, string> = {
    short: '请为以下内容生成一个简短的摘要，控制在100字以内，只保留最核心的信息。',
    medium: '请为以下内容生成一个中等长度的摘要，控制在200-300字左右，包含主要观点和关键信息。',
    long: '请为以下内容生成一个详细的摘要，控制在500字左右，涵盖所有重要内容和细节。',
  };
  return lengthPrompts[summaryLength] || '请为以下内容生成摘要。';
}
