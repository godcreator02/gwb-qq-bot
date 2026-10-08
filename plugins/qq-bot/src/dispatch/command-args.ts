/** 命令与注册方法的参数校验：只收列出的键、必填文字不能为空。系统边界上用，不符合就报错，不替调用方改 */
import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from '../qq/qq-protocol.js'

export function onlyKeys(raw: unknown, where: string, keys: string[]): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error(`${where} 的参数要是对象，含 ${keys.join('、')}`)
  const unknownKeys = Object.keys(raw).filter((key) => !keys.includes(key))
  if (unknownKeys.length > 0) throw new Error(`${where} 不认识参数 ${unknownKeys.join('、')}，只收 ${keys.join('、')}`)
  return raw
}

export function requireText(raw: Record<string, unknown>, key: string, meaning: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺 ${key}：${meaning}`)
  return value.trim()
}

export function optionalText(raw: Record<string, unknown>, key: string, meaning: string): string | undefined {
  return raw[key] === undefined ? undefined : requireText(raw, key, meaning)
}

export function requireExistingDirectory(raw: Record<string, unknown>, key: string): string {
  const workspace = requireText(raw, key, '执行任务的目录，绝对路径')
  if (!path.win32.isAbsolute(workspace) || !fs.statSync(workspace, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${key} 要是已存在目录的绝对路径，收到 ${workspace}`)
  return workspace
}
