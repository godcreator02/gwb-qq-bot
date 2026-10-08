/**
 * 核对组件名册两边：docfirst.config.mjs 里的机读规则表 vs src/components/registry.ts 里的 React 名单。
 * 机读规则只给生成正本里用到的组件写，所以 React 名单可以比机读规则表多；
 * 反过来不行：机读规则表里有、React 名单里没有的，是写错了名字或删了组件忘了删规则。
 * registry.ts 只有可擦除的类型，Node 直接运行。
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const config = (await import(pathToFileURL(resolve('docfirst.config.mjs')).href)).default
const { componentNames } = await import(pathToFileURL(resolve('src/components/registry.ts')).href)

const ai = new Set(Object.keys(config.components ?? {}))
const react = new Set(componentNames)
const onlyAi = [...ai].filter((n) => !react.has(n))

console.log(`机读规则表：${[...ai].join('、')}`)
console.log(`React 表：${[...react].join('、')}`)
if (onlyAi.length > 0) console.log(`✖ 只有机读规则、没有 React 组件：${onlyAi.join('、')}`)
console.log(onlyAi.length === 0 ? '✔ 机读规则表里的组件都在 React 表里' : '✖ 组件名册两边对不上')
process.exit(onlyAi.length === 0 ? 0 : 1)
