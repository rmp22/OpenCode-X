import type { OCXPipeline } from "@/ocx/ocx-pipeline"
import type { Header as SessionHeader } from "@/ocx/header"
import type { SessionID } from "../../session/schema"
import { PlaybookQueue } from "@/ocx/playbook/queue"
import { ReasoningStore } from "@/ocx/reasoning/store"
import { ActivityRuntime } from "@/ocx/activity/runtime"

type Key = string

const pipeline = new Map<Key, OCXPipeline.Result>()
const header = new Map<Key, SessionHeader>()
const headerDone = new Set<Key>()
const todosSynced = new Set<Key>()
const extras = new Map<Key, string>()
const rounds = new Map<Key, number>()
const signature = new Map<Key, string>()
const feedback = new Map<Key, string>()
const practiceHits = new Map<Key, string[]>()
const practiceInjected = new Set<Key>()
const patchAttempts = new Set<Key>()
const progressInjected = new Set<Key>()
const saliencePhase = new Map<Key, string>()
const reminderInjected = new Set<Key>()
const todoStateSignature = new Map<Key, string>()
const todoStateInjected = new Set<Key>()
const contextInjected = new Set<Key>()
const terminologyInjected = new Set<Key>()
const playbookSelectionEmitted = new Set<Key>()
const ownerGuidanceInjected = new Set<Key>()
const greenfieldInjected = new Set<Key>()
const reasoningSignature = new Map<Key, string>()
const batchingSignature = new Map<Key, string>()

export function turnKey(sessionID: SessionID | string, userId: string): Key {
  return `${String(sessionID)}:${userId}`
}

export const pipelineOf = (key: Key) => pipeline.get(key)
export const setPipeline = (key: Key, value: OCXPipeline.Result) => pipeline.set(key, value)

export const headerOf = (key: Key) => header.get(key)
export const setHeader = (key: Key, value: SessionHeader) => header.set(key, value)
export const hasHeader = (key: Key) => header.has(key)
export const markHeaderDone = (key: Key) => headerDone.add(key)
export const isHeaderDone = (key: Key) => headerDone.has(key)

export const markTodosSynced = (key: Key) => todosSynced.add(key)
export const isTodosSynced = (key: Key) => todosSynced.has(key)

export const extrasOf = (key: Key) => extras.get(key)
export const setExtras = (key: Key, value: string) => extras.set(key, value)
export const takeExtras = (key: Key) => {
  const value = extrasOf(key)
  if (value !== undefined) extras.delete(key)
  return value
}

export const roundOf = (key: Key) => rounds.get(key) ?? 0
export const setRound = (key: Key, round: number) => rounds.set(key, round)
export const clearRound = (key: Key) => {
  rounds.delete(key)
  signature.delete(key)
}

export const signatureOf = (key: Key) => signature.get(key)
export const setSignature = (key: Key, value: string) => signature.set(key, value)

export const takeFeedback = (key: Key): string | undefined => {
  const value = feedback.get(key)
  if (value !== undefined) feedback.delete(key)
  return value
}
export const setFeedback = (key: Key, value: string) => feedback.set(key, value)

export const practiceHitsOf = (key: Key) => practiceHits.get(key) ?? []
export const setPracticeHits = (key: Key, value: readonly string[]) => practiceHits.set(key, [...value])
export const markPracticeInjected = (key: Key) => practiceInjected.add(key)
export const isPracticeInjected = (key: Key) => practiceInjected.has(key)
export const markPatchAttempted = (key: Key) => patchAttempts.add(key)
export const isPatchAttempted = (key: Key) => patchAttempts.has(key)
export const markProgressInjected = (key: Key) => progressInjected.add(key)
export const isProgressInjected = (key: Key) => progressInjected.has(key)
export const markContextInjected = (key: Key) => contextInjected.add(key)
export const isContextInjected = (key: Key) => contextInjected.has(key)
export const saliencePhaseOf = (key: Key) => saliencePhase.get(key)
export const setSaliencePhase = (key: Key, value: string) => saliencePhase.set(key, value)
export const reasoningSignatureOf = (key: Key) => reasoningSignature.get(key)
export const setReasoningSignature = (key: Key, value: string) => reasoningSignature.set(key, value)
export const batchingSignatureOf = (key: Key) => batchingSignature.get(key)
export const setBatchingSignature = (key: Key, value: string) => batchingSignature.set(key, value)

export const markReminderInjected = (key: Key) => reminderInjected.add(key)
export const isReminderInjected = (key: Key) => reminderInjected.has(key)
export const markTodoStateInjected = (key: Key) => todoStateInjected.add(key)
export const isTodoStateInjected = (key: Key) => todoStateInjected.has(key)
export const markTerminologyInjected = (key: Key) => terminologyInjected.add(key)
export const isTerminologyInjected = (key: Key) => terminologyInjected.has(key)
export const markPlaybookSelectionEmitted = (key: Key) => playbookSelectionEmitted.add(key)
export const isPlaybookSelectionEmitted = (key: Key) => playbookSelectionEmitted.has(key)
export const markOwnerGuidanceInjected = (key: Key) => ownerGuidanceInjected.add(key)
export const isOwnerGuidanceInjected = (key: Key) => ownerGuidanceInjected.has(key)

export const markGreenfieldInjected = (key: Key) => greenfieldInjected.add(key)
export const isGreenfieldInjected = (key: Key) => greenfieldInjected.has(key)

export function shouldInjectTodoState(key: Key, signatureValue: string): boolean {
  if (todoStateSignature.get(key) === signatureValue) return false
  todoStateSignature.set(key, signatureValue)
  return true
}

export function clearTransient(sessionID: string): void {
  const prefix = `${sessionID}:`
  for (const map of [
    pipeline,
    header,
    extras,
    rounds,
    signature,
    feedback,
    practiceHits,
    saliencePhase,
    todoStateSignature,
    reasoningSignature,
    batchingSignature,
  ])
    for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key)
  for (const set of [headerDone, todosSynced, practiceInjected, patchAttempts, progressInjected, reminderInjected, todoStateInjected, terminologyInjected, playbookSelectionEmitted, ownerGuidanceInjected, greenfieldInjected])
    for (const key of set) if (key.startsWith(prefix)) set.delete(key)
  for (const key of contextInjected) if (key.startsWith(prefix)) contextInjected.delete(key)
  PlaybookQueue.clearQueue(sessionID)
  ActivityRuntime.clearTransient(sessionID)
}

export function clearSession(sessionID: string): void {
  clearTransient(sessionID)
  ReasoningStore.clearStatus(sessionID)
}

export * as State from "./state"
