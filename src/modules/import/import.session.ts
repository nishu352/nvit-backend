import { randomUUID } from "crypto";
import { FileSchema } from "./import.analyzer.js";
import { AiMappingResult } from "./import.aiMapper.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImportSession {
  id: string;
  createdAt: number;
  fileName: string;
  fileSize: number; // bytes
  schema: FileSchema;
  aiMapping: AiMappingResult;
  rawRows: Record<string, string>[]; // All rows from the file (server-side only)
  inFileDuplicates: number;
}

// ─── Session Store ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessions = new Map<string, ImportSession>();

// Cleanup expired sessions every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of sessions.entries()) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[ImportSession] Cleaned up ${cleaned} expired session(s)`);
    }
  },
  5 * 60 * 1000 // every 5 minutes
);

// ─── Session Management ───────────────────────────────────────────────────────

export function createSession(data: Omit<ImportSession, "id" | "createdAt">): string {
  const id = randomUUID();
  sessions.set(id, { ...data, id, createdAt: Date.now() });
  console.log(`[ImportSession] Created session ${id} with ${data.rawRows.length} rows`);
  return id;
}

export function getSession(id: string): ImportSession {
  const session = sessions.get(id);

  if (!session) {
    throw new Error(
      "Import session not found or has expired. Please re-upload the file to start a new analysis."
    );
  }

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    throw new Error(
      "Import session has expired (30-minute limit). Please re-upload the file to continue."
    );
  }

  return session;
}

export function deleteSession(id: string): void {
  const deleted = sessions.delete(id);
  if (deleted) {
    console.log(`[ImportSession] Deleted session ${id}`);
  }
}

export function getActiveSessions(): number {
  return sessions.size;
}
