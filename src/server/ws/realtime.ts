import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { getActiveAssignedRecruiterId, getDb } from '../db/database';
import { canAccessConversation, hashSessionToken } from '../domain/rules';
import { AuthActor, UserRole } from '../domain/types';

interface ClientSocket {
  ws: WebSocket;
  user: AuthActor;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Set<ClientSocket>>();

  attach(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/ws', 'http://localhost:3000');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'Authentication token required');
        return;
      }

      const actor = this.authenticateToken(token);
      if (!actor) {
        ws.close(4003, 'Invalid or expired session');
        return;
      }

      const client: ClientSocket = { ws, user: actor };
      if (!this.clients.has(actor.id)) {
        this.clients.set(actor.id, new Set());
      }
      this.clients.get(actor.id)!.add(client);

      // Send current online user IDs to newly connected client
      this.sendToSocket(ws, {
        type: 'presence:sync',
        onlineUserIds: this.getOnlineUserIds(),
      });

      // Notify everyone else of presence change
      this.broadcastAll({
        type: 'presence:update',
        userId: actor.id,
        online: true,
      });

      ws.on('message', (raw) => {
        try {
          const event = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
          this.handleClientEvent(actor, event);
        } catch {
          // Ignore malformed JSON frames
        }
      });

      ws.on('close', () => {
        const set = this.clients.get(actor.id);
        if (set) {
          set.delete(client);
          if (set.size === 0) {
            this.clients.delete(actor.id);
            this.broadcastAll({
              type: 'presence:update',
              userId: actor.id,
              online: false,
            });
          }
        }
      });
    });
  }

  private authenticateToken(token: string): AuthActor | null {
    const db = getDb();
    const tokenHash = hashSessionToken(token);
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.role, u.full_name, u.is_active
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?
           AND s.revoked_at IS NULL
           AND s.expires_at > datetime('now')
           AND u.is_active = 1
         LIMIT 1`
      )
      .get(tokenHash) as
      | { id: string; email: string; role: UserRole; full_name: string; is_active: number }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
      isActive: row.is_active === 1,
    };
  }

  private handleClientEvent(actor: AuthActor, event: Record<string, unknown>) {
    const type = String(event.type || '');
    const db = getDb();

    if (type === 'typing:start' || type === 'typing:stop') {
      const conversationId = String(event.conversationId || '');
      const conv = db
        .prepare('SELECT id, candidate_id, recruiter_id, thread_type FROM conversations WHERE id = ?')
        .get(conversationId) as
        | { id: string; candidate_id: string; recruiter_id: string; thread_type: string }
        | undefined;
      if (!conv) return;

      const activeRecruiter = getActiveAssignedRecruiterId(db, conv.candidate_id);
      if (
        !canAccessConversation(
          actor,
          { candidateId: conv.candidate_id, recruiterId: conv.recruiter_id, threadType: conv.thread_type },
          activeRecruiter
        )
      ) {
        return;
      }

      const targets = [conv.candidate_id, conv.recruiter_id].filter((id) => id !== actor.id);
      const payload = {
        type,
        conversationId,
        userId: actor.id,
        fullName: actor.fullName,
      };
      this.sendToUsers(targets, payload);
      if (actor.role !== UserRole.TeamLead && conv.thread_type === 'candidate_recruiter') {
        this.sendToTeamLeads(payload);
      }
      return;
    }

    // Real WebRTC Signaling Relay (verified participants only)
    if (
      type === 'call:invite' ||
      type === 'call:accept' ||
      type === 'call:decline' ||
      type === 'call:end' ||
      type === 'webrtc:offer' ||
      type === 'webrtc:answer' ||
      type === 'webrtc:ice'
    ) {
      const targetUserId = String(event.targetUserId || '');
      const conversationId = String(event.conversationId || '');
      if (!targetUserId || !conversationId) return;

      const conv = db
        .prepare('SELECT id, candidate_id, recruiter_id, thread_type FROM conversations WHERE id = ?')
        .get(conversationId) as
        | { id: string; candidate_id: string; recruiter_id: string; thread_type: string }
        | undefined;
      if (!conv) return;

      const activeRecruiter = getActiveAssignedRecruiterId(db, conv.candidate_id);
      if (
        !canAccessConversation(
          actor,
          { candidateId: conv.candidate_id, recruiterId: conv.recruiter_id, threadType: conv.thread_type },
          activeRecruiter
        )
      ) {
        return;
      }

      this.sendToUsers([targetUserId], {
        ...event,
        fromUserId: actor.id,
        fromUserName: actor.fullName,
      });
    }
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.clients.keys());
  }

  private sendToSocket(ws: WebSocket, payload: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  sendToUsers(userIds: string[], payload: Record<string, unknown>) {
    const unique = new Set(userIds);
    for (const uid of unique) {
      const sockets = this.clients.get(uid);
      if (!sockets) continue;
      for (const client of sockets) {
        this.sendToSocket(client.ws, payload);
      }
    }
  }

  sendToTeamLeads(payload: Record<string, unknown>) {
    for (const sockets of this.clients.values()) {
      for (const client of sockets) {
        if (client.user.role === UserRole.TeamLead) {
          this.sendToSocket(client.ws, payload);
        }
      }
    }
  }

  broadcastAll(payload: Record<string, unknown>) {
    for (const sockets of this.clients.values()) {
      for (const client of sockets) {
        this.sendToSocket(client.ws, payload);
      }
    }
  }

  // Called when a Netlify Server instance is stopping so clients reconnect
  // straight away instead of waiting for their sockets to time out.
  closeAll(): void {
    for (const sockets of this.clients.values()) {
      for (const client of sockets) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1012, 'Server restarting');
        }
      }
    }
    this.clients.clear();
    this.wss?.close();
  }
}

export const realtimeHub = new RealtimeHub();
