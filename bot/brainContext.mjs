export const MAX_SAY_LEN = 200
const RECENT_CHAT_CAP = 6

/** Compact, model-friendly snapshot of the bot's situation. Pure. */
export function buildBrainContext({ location, currentActivity, nearbyPilots = [], recentChat = [] }) {
  return {
    location: location ?? 'deep space',
    currentActivity: currentActivity ?? 'idle',
    nearbyPilots: nearbyPilots.slice(0, 8),
    recentChat: recentChat.slice(-RECENT_CHAT_CAP).map((c) => ({ name: String(c.name), text: String(c.text) })),
  }
}

/**
 * Parse the model's reply into a safe action. Accepts a bare JSON object or JSON embedded in prose.
 * Only `say` (string, clamped) and `goto` (must be a known landmark id) are honored. Anything else
 * is ignored. Returns {} on garbage.
 */
export function parseBrainOutput(text, validGotoIds) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!match) return {}
  let obj
  try { obj = JSON.parse(match[0]) } catch { return {} }
  if (!obj || typeof obj !== 'object') return {}
  const out = {}
  if (typeof obj.say === 'string' && obj.say.trim()) out.say = obj.say.trim().slice(0, MAX_SAY_LEN)
  if (typeof obj.goto === 'string' && validGotoIds.has(obj.goto)) out.goto = obj.goto
  return out
}
