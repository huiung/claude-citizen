import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

function cssBlockFor(selector: string): string {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(style)?.[1] ?? ''
}

describe('landing leaderboard layout CSS', () => {
  it('keeps landing pager arrow buttons compact inside the launch overlay', () => {
    const block = cssBlockFor('#overlay .lb-prev, #overlay .lb-next')

    expect(block).toContain('padding: 0')
    expect(block).toContain('letter-spacing: 0')
    expect(block).toContain('background: rgba(0, 18, 8, .55)')
    expect(block).toContain('font: 700 13px "Share Tech Mono"')
  })
})
