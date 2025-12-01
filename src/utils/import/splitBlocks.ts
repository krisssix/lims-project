export function splitIntoBlocks(lines: string[]): string[][] {
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || /^#{3,}$/.test(trimmed)) {
      if (current.length) {
        blocks.push(current)
        current = []
      }
      continue
    }
    current.push(line)
  }
  if (current.length) blocks.push(current)
  return blocks
}
