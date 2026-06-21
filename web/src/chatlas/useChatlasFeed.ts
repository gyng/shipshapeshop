// React subscriptions to the app-level Chatlas Plus transport. Read-only — the connection lifecycle is owned
// by <ChatlasNetDriver>. useChatlasFeed delivers structured events (+ roster); useChatlasChat delivers free-text
// chat; useChatlasRoster is roster-only (for the shared status header). All seed with the recent buffer first.
import { useEffect, useRef, useState } from 'react'
import { getRecentChat, getRecentEvents, onChatlasChat, onChatlasEvent, onChatlasRoster, onChatlasTyping } from './chatlasNet'
import type { ChatlasProfile, ChatMessage, PeerEvent, RosterEntry } from './transport'

export function useChatlasFeed(onPeerEvent: (e: PeerEvent) => void) {
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const cbRef = useRef(onPeerEvent)
  cbRef.current = onPeerEvent
  useEffect(() => {
    for (const e of getRecentEvents()) cbRef.current(e) // seed with recent history, then go live
    const offEvent = onChatlasEvent((e) => cbRef.current(e))
    const offRoster = onChatlasRoster(setRoster)
    return () => {
      offEvent()
      offRoster()
    }
  }, [])
  return { roster }
}

export function useChatlasChat(onChatMessage: (m: ChatMessage) => void) {
  const cbRef = useRef(onChatMessage)
  cbRef.current = onChatMessage
  useEffect(() => {
    for (const m of getRecentChat()) cbRef.current(m) // seed with recent chat
    const off = onChatlasChat((m) => cbRef.current(m))
    return () => off()
  }, [])
}

export function useChatlasRoster(): RosterEntry[] {
  const [roster, setRoster] = useState<RosterEntry[]>([])
  useEffect(() => onChatlasRoster(setRoster), [])
  return roster
}

export function useChatlasTyping(onTyping: (p: ChatlasProfile) => void) {
  const cbRef = useRef(onTyping)
  cbRef.current = onTyping
  useEffect(() => onChatlasTyping((p) => cbRef.current(p)), [])
}
