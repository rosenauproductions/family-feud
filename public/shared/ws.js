let socket = null;
let role = 'display';
let onState = () => {};
let reconnectTimer = null;

export function connect(clientRole, stateCallback) {
  role = clientRole;
  onState = stateCallback;
  fetchInitialState();
  openSocket();
}

async function fetchInitialState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const state = await res.json();
    onState(state);
  } catch {
    // Server may still be starting
  }
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}?role=${role}`;
}

function openSocket() {
  if (socket?.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(wsUrl());

  socket.addEventListener('open', () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'state') onState(msg.state);
  });

  socket.addEventListener('close', () => {
    reconnectTimer = setTimeout(openSocket, 1500);
  });
}

/** Host actions use HTTP so the controller updates immediately; display still syncs via WebSocket. */
export async function sendAction(action, payload = {}) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Action failed');
  if (data.state) onState(data.state);
}
