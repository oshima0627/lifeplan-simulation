import { describe, expect, it } from "vitest";
import {
  consumePasswordReset,
  createPasswordReset,
  deleteAllSessionsForUser,
  updatePasswordHash,
} from "./db";

// worker/auth/routes.test.ts の FakeD1 と同じ考え方: prepare() に渡された
// SQL 文の接頭辞で分岐する最小限のスタブ。ここで固定したいのは db.ts が
// 発行する SQL の「原子性」（特に consumePasswordReset の検証と使用済み化が
// 同一SQL文であること）なので、実際の SQLite の条件評価をここでも
// 素直に再現する。

interface FakeResetRow {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

interface FakeUserRow {
  id: string;
  passwordHash: string;
}

interface FakeSessionRow {
  tokenHash: string;
  userId: string;
}

class FakeD1 {
  resets: FakeResetRow[] = [];
  users: FakeUserRow[] = [];
  sessions: FakeSessionRow[] = [];

  prepare = (sql: string) => {
    const run = async (...args: unknown[]) => {
      if (sql.startsWith("INSERT INTO password_resets")) {
        const [tokenHash, userId, expiresAt] = args as [string, string, string];
        this.resets.push({ tokenHash, userId, expiresAt, usedAt: null });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE password_resets SET used_at")) {
        const [usedAt, tokenHash, nowIso] = args as [string, string, string];
        const row = this.resets.find(
          (r) => r.tokenHash === tokenHash && r.usedAt === null && r.expiresAt > nowIso,
        );
        if (!row) return { meta: { changes: 0 } };
        row.usedAt = usedAt;
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE users SET password_hash")) {
        const [passwordHash, userId] = args as [string, string];
        const user = this.users.find((u) => u.id === userId);
        if (!user) return { meta: { changes: 0 } };
        user.passwordHash = passwordHash;
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM sessions WHERE user_id")) {
        const [userId] = args as [string];
        const before = this.sessions.length;
        this.sessions = this.sessions.filter((s) => s.userId !== userId);
        return { meta: { changes: before - this.sessions.length } };
      }
      throw new Error(`FakeD1: unhandled run() for "${sql}"`);
    };

    const first = async <T,>(...args: unknown[]): Promise<T | null> => {
      if (sql.startsWith("SELECT user_id FROM password_resets")) {
        const [tokenHash] = args as [string];
        const row = this.resets.find((r) => r.tokenHash === tokenHash);
        return row ? ({ user_id: row.userId } as T) : null;
      }
      throw new Error(`FakeD1: unhandled first() for "${sql}"`);
    };

    return {
      bind: (...args: unknown[]) => ({
        run: () => run(...args),
        first: <T,>() => first<T>(...args),
      }),
    };
  };
}

const NOW = new Date("2026-08-12T00:00:00.000Z");
const IN_30_MIN = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString();
const TEN_MIN_AGO = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();

describe("createPasswordReset / consumePasswordReset", () => {
  it("有効なトークンなら userId を返す", async () => {
    const db = new FakeD1();
    await createPasswordReset(db as unknown as D1Database, {
      tokenHash: "hash-1",
      userId: "user-1",
      expiresAt: IN_30_MIN,
    });

    const userId = await consumePasswordReset(db as unknown as D1Database, "hash-1", NOW);
    expect(userId).toBe("user-1");
  });

  it("同じトークンを2回使うと2回目は null になる（二重使用の防止）", async () => {
    const db = new FakeD1();
    await createPasswordReset(db as unknown as D1Database, {
      tokenHash: "hash-2",
      userId: "user-2",
      expiresAt: IN_30_MIN,
    });

    const first = await consumePasswordReset(db as unknown as D1Database, "hash-2", NOW);
    const second = await consumePasswordReset(db as unknown as D1Database, "hash-2", NOW);

    expect(first).toBe("user-2");
    expect(second).toBeNull();
  });

  it("期限切れなら null（未使用でも）", async () => {
    const db = new FakeD1();
    await createPasswordReset(db as unknown as D1Database, {
      tokenHash: "hash-3",
      userId: "user-3",
      expiresAt: TEN_MIN_AGO,
    });

    const userId = await consumePasswordReset(db as unknown as D1Database, "hash-3", NOW);
    expect(userId).toBeNull();
  });

  it("存在しないトークンハッシュなら null", async () => {
    const db = new FakeD1();
    const userId = await consumePasswordReset(db as unknown as D1Database, "no-such-hash", NOW);
    expect(userId).toBeNull();
  });
});

describe("updatePasswordHash", () => {
  it("指定した userId のパスワードハッシュだけを更新する", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", passwordHash: "old-1" });
    db.users.push({ id: "user-2", passwordHash: "old-2" });

    await updatePasswordHash(db as unknown as D1Database, "user-1", "new-1");

    expect(db.users.find((u) => u.id === "user-1")?.passwordHash).toBe("new-1");
    expect(db.users.find((u) => u.id === "user-2")?.passwordHash).toBe("old-2");
  });
});

describe("deleteAllSessionsForUser", () => {
  it("指定ユーザーの全セッションを削除し、他ユーザーのセッションは残す", async () => {
    const db = new FakeD1();
    db.sessions.push({ tokenHash: "t1", userId: "user-1" });
    db.sessions.push({ tokenHash: "t2", userId: "user-1" });
    db.sessions.push({ tokenHash: "t3", userId: "user-2" });

    await deleteAllSessionsForUser(db as unknown as D1Database, "user-1");

    expect(db.sessions).toEqual([{ tokenHash: "t3", userId: "user-2" }]);
  });

  it("セッションが無いユーザーでも例外を投げない（冪等）", async () => {
    const db = new FakeD1();
    await expect(
      deleteAllSessionsForUser(db as unknown as D1Database, "no-such-user"),
    ).resolves.toBeUndefined();
  });
});
