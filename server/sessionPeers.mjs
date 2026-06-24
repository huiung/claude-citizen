/** Wallet identities get a sticky callsign: once a pubkey has a stored (non-placeholder) name,
 *  later launches under a different name are ignored. Anonymous pilots use their requested name. */
export function resolveCallsign({ authed, storedName, requestedName }) {
  const requested = String(requestedName ?? 'PILOT').slice(0, 16) || 'PILOT'
  if (!authed) return requested
  const stored = String(storedName ?? '').slice(0, 16)
  return stored.trim() && stored.toLowerCase() !== 'pilot' ? stored : requested
}

/** The progress/live-session key for a client: verified pubkey if authed, else the raw token. */
export function identityKey(client) {
  return client?.authed && client.pubkey ? client.pubkey : client?.token
}

export function kickDuplicateActiveClients(clients, currentWs, currentClient) {
  const key = identityKey(currentClient)
  const token = currentClient?.token
  if (!key && !token) return []
  const removed = []
  for (const [ws, client] of [...clients]) {
    if (ws === currentWs || !client.active) continue
    const sameIdentity = key && identityKey(client) === key
    const sameAnonToken = token && client.token === token
    if (!sameIdentity && !sameAnonToken) continue
    try { ws.send(JSON.stringify({ t: 'kicked' })) } catch { /* already gone */ }
    clients.delete(ws)
    try { ws.close() } catch { /* already gone */ }
    removed.push({ ws, client })
  }
  return removed
}
