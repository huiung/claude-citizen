export function holderNameplateClass(tier: number): string {
  return tier > 0 ? `nameplate holder t${tier}` : 'nameplate'
}

export function holderNameplateText(name: string, _tier: number): string {
  return name
}
