/// <reference lib="webworker" />

import type { ParserOptions } from '@/utils/importParsing'
import { analyzeClipboard } from '@/utils/importParsing'

// Pomocné typy pro zprávy
type ParseRequest = { id: number; text: string; opts: ParserOptions }
type ParseSuccess = { id: number; result: ReturnType<typeof analyzeClipboard> }
type ParseError = { id: number; error: string }

// `self` je v workeru DedicatedWorkerGlobalScope
const ctx = self as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const { id, text, opts } = ev.data
  try {
    const result = analyzeClipboard(text, opts)
    const msg: ParseSuccess = { id, result }
    ctx.postMessage(msg)
  } catch (e) {
    const msg: ParseError = { id, error: (e as Error)?.message ?? 'parse failed' }
    ctx.postMessage(msg)
  }
}

// označ jako modul (umlčí „Vue: Cannot find name…“ ve Volaru)
export {}
