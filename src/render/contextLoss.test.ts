// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createContextLossNotice, watchContextLoss } from './contextLoss'

describe('watchContextLoss', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('raises a notice when the context is lost', () => {
    const canvas = new EventTarget()
    const show = vi.fn()
    watchContextLoss(canvas, show)

    canvas.dispatchEvent(new Event('webglcontextlost'))

    expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0]).toMatch(/CONTEXT LOST/)
  })

  it('clears the notice when the context comes back', () => {
    const canvas = new EventTarget()
    const show = vi.fn()
    watchContextLoss(canvas, show)

    canvas.dispatchEvent(new Event('webglcontextlost'))
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    expect(show).toHaveBeenLastCalledWith(null)
  })

  // The whole value of this module is that a bug report can distinguish a context loss from a frozen
  // frame loop, and that only works if the loss reaches the log rather than console.log's noise.
  it('logs the loss at error level', () => {
    const canvas = new EventTarget()
    watchContextLoss(canvas, () => {})

    canvas.dispatchEvent(new Event('webglcontextlost'))

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[gpu]'), expect.anything(),
    )
  })

  it('detaches cleanly', () => {
    const canvas = new EventTarget()
    const show = vi.fn()
    watchContextLoss(canvas, show)()

    canvas.dispatchEvent(new Event('webglcontextlost'))

    expect(show).not.toHaveBeenCalled()
  })
})

describe('createContextLossNotice', () => {
  it('adds one persistent node and removes it on recovery', () => {
    const parent = document.createElement('div')
    const show = createContextLossNotice(parent, document)

    show('◈ GRAPHICS CONTEXT LOST')
    expect(parent.children).toHaveLength(1)
    expect(parent.textContent).toContain('CONTEXT LOST')

    // A second loss must not stack a second banner on top of the first.
    show('◈ GRAPHICS CONTEXT LOST')
    expect(parent.children).toHaveLength(1)

    show(null)
    expect(parent.children).toHaveLength(0)
  })
})
