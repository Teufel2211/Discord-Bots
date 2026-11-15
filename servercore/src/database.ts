import { createClient } from "@supabase/supabase-js";

export type QueryResult<Row> = {
  rows: Row[];
  rowCount: number;
};

type SqlStatement = {
  sql: string;
  params: unknown[];
};

export type DatabaseConnection = {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
  release(): void;
};

export type ServerCoreDatabase = {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
  rpc<Result = unknown>(name: string, args: Record<string, unknown>): Promise<Result>;
  connect(): Promise<DatabaseConnection>;
};

function restorePostgresDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restorePostgresDates);
  if (!value || typeof value !== "object") return value;

  const restored: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && /_(at|date)$/i.test(key)) {
      const parsed = new Date(item);
      restored[key] = Number.isNaN(parsed.getTime()) ? item : parsed;
    } else {
      restored[key] = restorePostgresDates(item);
    }
  }
  return restored;
}

function normalizeResult<Row>(value: unknown): QueryResult<Row> {
  if (!value || typeof value !== "object") {
    return { rows: [], rowCount: 0 };
  }

  const result = value as { rows?: unknown; rowCount?: unknown };
  return {
    rows: Array.isArray(result.rows)
      ? (result.rows.map(restorePostgresDates) as Row[])
      : [],
    rowCount: Number.isFinite(Number(result.rowCount)) ? Number(result.rowCount) : 0
  };
}

export function createDatabase(supabaseUrl: string, secretKey: string): ServerCoreDatabase {
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is required.");

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        "X-Client-Info": "servercore-discord-bot"
      }
    }
  });

  async function execute<Row>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<Row>> {
    const { data, error } = await supabase.rpc("sc_exec_sql", {
      p_sql: sql,
      p_params: params
    });

    if (error) {
      throw new Error("[Supabase SQL] " + error.message, { cause: error });
    }

    return normalizeResult<Row>(data);
  }

  async function rpc<Result>(
    name: string,
    args: Record<string, unknown>
  ): Promise<Result> {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      throw new Error("[Supabase RPC " + name + "] " + error.message, { cause: error });
    }
    return data as Result;
  }

  return {
    query: execute,
    rpc,
    async connect(): Promise<DatabaseConnection> {
      let transaction: SqlStatement[] | null = null;

      return {
        async query<Row = Record<string, unknown>>(
          sql: string,
          params: unknown[] = []
        ): Promise<QueryResult<Row>> {
          const command = sql.trim().replace(/;$/, "").trim();

          if (/^BEGIN(?:\\s|$)/i.test(command)) {
            if (transaction) throw new Error("A Supabase transaction is already active.");
            transaction = [];
            return { rows: [], rowCount: 0 };
          }

          if (/^ROLLBACK(?:\\s|$)/i.test(command)) {
            transaction = null;
            return { rows: [], rowCount: 0 };
          }

          if (/^COMMIT(?:\\s|$)/i.test(command)) {
            if (!transaction) return { rows: [], rowCount: 0 };
            const statements = transaction;
            transaction = null;
            if (statements.length === 0) return { rows: [], rowCount: 0 };

            const { data, error } = await supabase.rpc("sc_exec_batch", {
              p_statements: statements
            });
            if (error) {
              throw new Error("[Supabase transaction] " + error.message, { cause: error });
            }

            const results = Array.isArray(data) ? data : [];
            return {
              rows: [],
              rowCount: results.reduce((total: number, item: unknown) => {
                return total + normalizeResult(item).rowCount;
              }, 0)
            };
          }

          if (transaction) {
            transaction.push({ sql, params });
            return { rows: [], rowCount: 0 };
          }

          return execute<Row>(sql, params);
        },
        release(): void {
          // A connection cannot hold server-side state between Data API calls.
          // Uncommitted buffered statements are discarded on release.
          transaction = null;
        }
      };
    }
  };
}

export async function checkDatabase(database: ServerCoreDatabase): Promise<void> {
  await database.query("SELECT guild_id FROM \\"SC_guilds\\" LIMIT 0");
}

/**
 * Schema changes are delivered as versioned SQL migrations. The bot only
 * performs a cheap Data API health check at startup; it never needs a
 * PostgreSQL connection string or a runtime DDL connection.
 */
export async function runMigrations(database: ServerCoreDatabase): Promise<void> {
  await checkDatabase(database);
}

export async function enqueueJob(
  database: ServerCoreDatabase,
  jobName: string,
  payload: Record<string, unknown> = {},
  runAt: Date = new Date(),
  maxAttempts = 5
): Promise<string> {
  const result = await database.query<{ job_id: string }>(
    'INSERT INTO "SC_jobs" (job_name,payload,run_at,max_attempts) VALUES ($1,$2::jsonb,$3,$4) RETURNING job_id',
    [jobName, JSON.stringify(payload), runAt, maxAttempts]
  );
  const jobId = result.rows[0]?.job_id;
  if (!jobId) throw new Error("Could not enqueue job.");
  return jobId;
}

export async function closeDatabase(_database: ServerCoreDatabase): Promise<void> {
  // supabase-js uses HTTP requests and does not keep a PostgreSQL pool open.
}
