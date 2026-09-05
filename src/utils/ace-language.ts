const modeMap: Record<string, string> = {
  'js': 'javascript',
  'jsx': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'py': 'python',
  'sh': 'sh',
  'bash': 'sh',
  'zsh': 'sh',
  'fish': 'sh',
  'sql': 'sql',
  'html': 'html',
  'htm': 'html',
  'css': 'css',
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'md': 'markdown',
  'markdown': 'markdown',
  'dockerfile': 'dockerfile',
}

export function getLanguageMode(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return modeMap[ext || ''] || 'text'
}
