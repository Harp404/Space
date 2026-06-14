// Same-origin: in dev the Vite proxy forwards /api + /ws to :8090; in production
// the gateway serves this frontend AND /api + /ws from the very same origin.
// Nothing here exposes the backend host — the browser only ever sees its own URL.
const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
export const GATEWAY = ''                                  // relative — same origin
export const WS_URL = `${proto}://${window.location.host}/ws`
