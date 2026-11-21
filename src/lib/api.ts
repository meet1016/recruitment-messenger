// In-memory session token store (never written to localStorage or sessionStorage)
let activeBearerToken: string | null = null;

export function setAuthToken(token: string | null): void {
  activeBearerToken = token;
}

export function getAuthToken(): string | null {
  return activeBearerToken;
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (activeBearerToken) {
    headers.Authorization = `Bearer ${activeBearerToken}`;
  }

  let fetchBody: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isFormData && options.body instanceof FormData) {
      fetchBody = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(options.body);
    }
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: fetchBody,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export type RealtimeEventHandler = (event: Record<string, any>) => void;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<RealtimeEventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  connect(token: string) {
    this.disconnect();
    this.intentionallyClosed = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    const openSocket = () => {
      if (this.intentionallyClosed || !activeBearerToken) return;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          this.listeners.forEach((fn) => fn(parsed));
        } catch {
          // ignore invalid frame
        }
      };

      ws.onclose = () => {
        if (!this.intentionallyClosed && activeBearerToken) {
          this.reconnectTimer = setTimeout(openSocket, 2500);
        }
      };
    };

    openSocket();
  }

  disconnect() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(payload: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  subscribe(handler: RealtimeEventHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
}

export const realtimeClient = new RealtimeClient();
