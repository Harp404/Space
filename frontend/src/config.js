const host = window.location.hostname || 'localhost'
export const GATEWAY = `http://${host}:8090`
export const WS_URL = `ws://${host}:8090/ws`
