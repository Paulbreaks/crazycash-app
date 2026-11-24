import { config } from '../../shared/config';

type ClientDiagnosticEvent =
  | 'shell_runtime_error'
  | 'shell_unhandled_rejection'
  | 'game_webgl2_unavailable';

const reportedEvents = new Set<string>();

function toMessage(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  return 'Unknown browser error';
}

export function reportClientDiagnostic(event: ClientDiagnosticEvent, error: unknown) {
  const message = toMessage(error).slice(0, 500);
  const key = `${event}:${message}`;
  if (reportedEvents.has(key)) return;
  reportedEvents.add(key);

  void fetch(`${config.apiBaseUrl}/client-diagnostics`, {
    method: 'POST',
    credentials: 'omit',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, message, route: '/game' }),
  }).catch(() => undefined);
}

export function installClientDiagnostics() {
  if (window.location.pathname !== '/game') return;

  window.addEventListener('error', (event) => {
    reportClientDiagnostic('shell_runtime_error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientDiagnostic('shell_unhandled_rejection', event.reason);
  });
}
