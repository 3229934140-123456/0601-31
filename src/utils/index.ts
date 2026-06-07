import * as fs from 'fs';
import * as path from 'path';

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 8);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substr(0, maxLength - 3) + '...';
}

export function readTextFilesFromDir(dirPath: string): { fileName: string; content: string; filePath: string }[] {
  const results: { fileName: string; content: string; filePath: string }[] = [];

  if (!fs.existsSync(dirPath)) return results;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) continue;

    const ext = path.extname(file).toLowerCase();
    if (['.txt', '.md', '.json', '.csv'].includes(ext)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        results.push({
          fileName: file,
          content,
          filePath,
        });
      } catch (error) {
        // skip unreadable files
      }
    }
  }

  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(decimals) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(decimals) + 'K';
  }
  return num.toFixed(decimals);
}

export function parseVariables(vars: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const v of vars) {
    const eqIndex = v.indexOf('=');
    if (eqIndex > 0) {
      const key = v.substring(0, eqIndex).trim();
      const value = v.substring(eqIndex + 1);
      result[key] = value;
    }
  }
  return result;
}
