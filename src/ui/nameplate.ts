export function holderNameplateClass(tier: number): string {
  return tier > 0 ? `nameplate holder t${tier}` : 'nameplate'
}

export function holderChatNameClass(tier: number): string {
  return tier > 0 ? `chat-name holder t${tier}` : 'chat-name'
}

export function holderNameplateText(name: string, _tier: number): string {
  return name
}
