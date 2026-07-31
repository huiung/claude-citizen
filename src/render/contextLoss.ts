/** Make a lost WebGL context say so, instead of letting the game freeze in silence.
 *
 *  Why this exists: a player reported being "thrown out" while flying into Earth and could not tell
 *  whether it was a crash. Neither could we, and that is the actual defect being fixed here — not the
 *  freeze, the silence. Three different failures look identical from the pilot's seat:
 *
 *    * the GPU dropped the context (driver reset, memory pressure, the tab being backgrounded on a
 *      laptop that switched GPUs),
 *    * an exception escaped the frame loop and `requestAnimationFrame` was never rescheduled,
 *    * the renderer process died outright.
 *
 *  Only the first one fires these events. So a report that arrives WITH this notice is a context
 *  loss, and a report that arrives WITHOUT it is one of the other two — which is the single bit of
 *  information a bug report from the wild currently cannot carry, and the reason an Earth-entry
 *  crash could be measured against for a whole session without being identified.
 *
 *  `WebGLRenderer` already registers its own `webglcontextlost` listener and calls `preventDefault()`
 *  there, which is what permits the browser to restore the context at all; it also logs, but only to
 *  `console.log`, which is indistinguishable from noise in a shipped build. This adds the part three
 *  leaves to the application: telling the person looking at the screen, and logging at a level worth
 *  grepping for. It deliberately does NOT call `preventDefault()` itself — doing that from a second
 *  listener would be redundant, and skipping it keeps the recovery policy in exactly one place.
 *
 *  The notice element is built here rather than added to index.html on purpose: nothing else needs
 *  it, and a static id would be one more thing for `check-dom-ids` to police for a node that exists
 *  only in a failure that should never happen.
 */

/** Attach the watcher. Returns a detach function for tests and hot reload. */
export function watchContextLoss(
  canvas: EventTarget,
  show: (message: string | null) => void,
): () => void {
  const onLost = (event: Event): void => {
    // `statusMessage` is where a driver explains itself when it bothers to; usually empty.
    const detail = (event as WebGLContextEvent).statusMessage
    console.error('[gpu] WebGL context lost — rendering has stopped.', detail || '(no driver message)')
    show('◈ GRAPHICS CONTEXT LOST — reload to continue')
  }
  const onRestored = (): void => {
    console.error('[gpu] WebGL context restored.')
    show(null)
  }
  canvas.addEventListener('webglcontextlost', onLost, false)
  canvas.addEventListener('webglcontextrestored', onRestored, false)
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false)
    canvas.removeEventListener('webglcontextrestored', onRestored, false)
  }
}

/** The default `show`: a fixed, centred banner that persists until the context comes back.
 *
 *  Persistent rather than a timed toast because the condition is persistent — a notice that faded
 *  after three seconds would reproduce the original problem, which is a player who saw the game stop
 *  and had nothing to report but "it got thrown out". */
export function createContextLossNotice(parent: HTMLElement, doc: Document = document): (message: string | null) => void {
  let el: HTMLElement | null = null
  return (message) => {
    if (message === null) { el?.remove(); el = null; return }
    if (!el) {
      el = doc.createElement('div')
      el.setAttribute('role', 'alert')
      el.style.cssText = [
        'position:fixed', 'left:50%', 'top:44%', 'transform:translate(-50%,-50%)',
        'z-index:9999', 'padding:14px 22px', 'pointer-events:none',
        'font:600 15px/1.4 "Share Tech Mono",monospace', 'letter-spacing:0.08em',
        'color:#ff6b6b', 'background:rgba(8,10,16,0.86)', 'border:1px solid rgba(255,107,107,0.5)',
        'text-align:center',
      ].join(';')
      parent.appendChild(el)
    }
    el.textContent = message
  }
}
