// SQLite singleton + schema. Substitui Deno KV.
//
// Schema v2: consolida 28 tabelas em 16.
// - Singletons (rodada_atual, simulando, mercado_cache, etc) viram rows
//   em `app_state(key, data_json)`.
// - time_visual, melhor_time, subs_usadas viram colunas em `elencos`.
// - oauth_state e email_map viram entries em `app_state` (count baixo,
//   query rápida não importa).
// - partidas_cache vira singleton em `app_state` (20 rows num record).
//
// Path do banco vem de DB_PATH env (prod = /data/app.db).

import { Database } from "@db/sqlite";

const DEFAULT_PATH = "./data/app.db";
const SCHEMA_VERSION = 2;

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const path = Deno.env.get("DB_PATH") || DEFAULT_PATH;
  try {
    const dir = path.replace(/\/[^/]+$/, "");
    if (dir && dir !== path) Deno.mkdirSync(dir, { recursive: true });
  } catch (_) { /* já existe */ }
  // int64: true — sem isso, o @db/sqlite trunca silenciosamente
  // numbers > 2^31 (Date.now() = ~1.78e12) pra int32 ao fazer .run().
  // O bug aparecia em createSession: expires_at virava negativo, e
  // getSession imediatamente posterior retornava null (sempre expirado).
  _db = new Database(path, { int64: true });
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA synchronous = NORMAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");
  initSchema(_db);
  migrateIfNeeded(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Converte number pra BigInt pra evitar truncamento int32 no driver
 *  @db/sqlite. Timestamps Date.now() (~13 dígitos) ultrapassam 2^31.
 *  Use sempre que passar `Date.now()` ou similar pra `.run(...)`. */
export function i64(n: number): bigint {
  return BigInt(n);
}

function getUserVersion(db: Database): number {
  const r = db.prepare("PRAGMA user_version").get<{ user_version: number }>();
  return r?.user_version ?? 0;
}

function setUserVersion(db: Database, v: number): void {
  db.exec(`PRAGMA user_version = ${v}`);
}

// ============================================================
// SCHEMA v2 — idempotente
// ============================================================

function initSchema(db: Database): void {
  db.exec(`
    -- Elencos: 1 row por time. Engole as ex-tabelas:
    --   time_visual (overrides), melhor_time (cache), subs_usadas (rodada atual).
    CREATE TABLE IF NOT EXISTS elencos (
      chave TEXT PRIMARY KEY,
      nome_time TEXT NOT NULL,
      dono TEXT NOT NULL,
      -- Overrides visuais editáveis pelo admin (ex-time_visual)
      nome_time_override TEXT,
      display_name_override TEXT,
      logo_override TEXT,
      visual_updated_at TEXT,
      -- Cache da escalação computada com auto-subs (ex-melhor_time)
      melhor_time_json TEXT,
      -- Subs banco↔escala usadas na rodada ao_vivo atual (ex-subs_usadas).
      -- Quando rodada muda, count zera e rodada atualiza.
      subs_usadas_rodada INTEGER,
      subs_usadas_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jogadores (
      chave TEXT NOT NULL,
      atleta_id INTEGER NOT NULL,
      apelido_api TEXT NOT NULL,
      clube TEXT NOT NULL,
      clube_id INTEGER NOT NULL,
      posicao TEXT NOT NULL,
      posicao_id INTEGER NOT NULL,
      escalacao TEXT NOT NULL CHECK (escalacao IN ('Sim','Banco','Não')),
      status_id INTEGER,
      provavel INTEGER,
      lesionado INTEGER,
      suspenso INTEGER,
      nulo INTEGER,
      entrou_em_campo INTEGER,
      clube_casa TEXT,
      clube_fora TEXT,
      pontos REAL,
      PRIMARY KEY (chave, atleta_id),
      FOREIGN KEY (chave) REFERENCES elencos(chave) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jogadores_atleta ON jogadores(atleta_id);

    CREATE TABLE IF NOT EXISTS historico (
      chave TEXT NOT NULL,
      rodada INTEGER NOT NULL,
      pontos REAL NOT NULL,
      PRIMARY KEY (chave, rodada)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user','admin')),
      chave TEXT,
      email TEXT,
      name TEXT,
      picture TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
      -- last_seen_at adicionada via ensureIncrementalColumns —
      -- bancos antigos (v2) já existem com a tabela sem essa coluna;
      -- declarar aqui faria CREATE INDEX abaixo falhar.
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- Cache de atletas Cartola (1 row por atleta)
    CREATE TABLE IF NOT EXISTS atletas_cache (
      atleta_id INTEGER PRIMARY KEY,
      apelido TEXT NOT NULL,
      clube TEXT NOT NULL,
      clube_id INTEGER NOT NULL,
      posicao TEXT NOT NULL,
      posicao_id INTEGER NOT NULL,
      status_id INTEGER,
      foto TEXT,
      atualizado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_atletas_cache_pos ON atletas_cache(posicao_id);

    -- Negociáveis (ex-à venda)
    CREATE TABLE IF NOT EXISTS a_venda (
      atleta_id INTEGER PRIMARY KEY,
      chave TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_a_venda_chave ON a_venda(chave);

    -- Interesses de draft (1 row por (chave_ofertante, atleta_alvo))
    CREATE TABLE IF NOT EXISTS interesses (
      chave TEXT NOT NULL,
      atleta_alvo INTEGER NOT NULL,
      atleta_oferecido INTEGER NOT NULL,
      criado_em INTEGER NOT NULL,
      PRIMARY KEY (chave, atleta_alvo)
    );
    CREATE INDEX IF NOT EXISTS idx_interesses_alvo ON interesses(atleta_alvo);

    -- Ordem pessoal dos meus interesses
    CREATE TABLE IF NOT EXISTS prioridades (
      chave TEXT NOT NULL,
      atleta_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      PRIMARY KEY (chave, atleta_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prioridades ON prioridades(chave, ordem);

    -- Ofertas (multi-jogador) + tabelas filhas mantidas pra indexabilidade
    CREATE TABLE IF NOT EXISTS ofertas (
      id TEXT PRIMARY KEY,
      de_chave TEXT NOT NULL,
      para_chave TEXT NOT NULL,
      atleta_pedido INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pendente','aceita','negada','cancelada')),
      criado_em INTEGER NOT NULL,
      respondido_em INTEGER,
      mensagem TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ofertas_de    ON ofertas(de_chave);
    CREATE INDEX IF NOT EXISTS idx_ofertas_para  ON ofertas(para_chave);
    CREATE INDEX IF NOT EXISTS idx_ofertas_status ON ofertas(status);

    CREATE TABLE IF NOT EXISTS oferta_oferecidos (
      oferta_id TEXT NOT NULL,
      atleta_id INTEGER NOT NULL,
      ordem     INTEGER NOT NULL,
      PRIMARY KEY (oferta_id, atleta_id),
      FOREIGN KEY (oferta_id) REFERENCES ofertas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oferta_extras (
      oferta_id TEXT NOT NULL,
      atleta_id INTEGER NOT NULL,
      ordem     INTEGER NOT NULL,
      PRIMARY KEY (oferta_id, atleta_id),
      FOREIGN KEY (oferta_id) REFERENCES ofertas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notificacoes (
      id TEXT PRIMARY KEY,
      chave TEXT NOT NULL,
      tipo TEXT NOT NULL,
      oferta_id TEXT NOT NULL,
      lida INTEGER NOT NULL DEFAULT 0,
      criado_em INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_chave  ON notificacoes(chave);
    CREATE INDEX IF NOT EXISTS idx_notif_lida   ON notificacoes(chave, lida);

    CREATE TABLE IF NOT EXISTS historico_trocas (
      id TEXT PRIMARY KEY,
      oferta_id TEXT NOT NULL,
      chave_a TEXT NOT NULL,
      atleta_a_id INTEGER NOT NULL,
      atleta_a_apelido TEXT NOT NULL,
      atleta_a_escalacao TEXT NOT NULL,
      chave_b TEXT NOT NULL,
      atleta_b_id INTEGER NOT NULL,
      atleta_b_apelido TEXT NOT NULL,
      atleta_b_escalacao TEXT NOT NULL,
      criado_em INTEGER NOT NULL,
      desfeito_em INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_trocas_criado ON historico_trocas(criado_em DESC);

    -- Eventos de scout (timeline ao vivo)
    CREATE TABLE IF NOT EXISTS evento_hist (
      rodada INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      atleta_id INTEGER NOT NULL,
      codigo TEXT NOT NULL,
      qtd INTEGER NOT NULL,
      PRIMARY KEY (rodada, ts, atleta_id, codigo)
    );
    CREATE INDEX IF NOT EXISTS idx_evento_rodada ON evento_hist(rodada, ts DESC);

    CREATE TABLE IF NOT EXISTS scout_estado (
      rodada INTEGER NOT NULL,
      atleta_id INTEGER NOT NULL,
      codigo TEXT NOT NULL,
      qtd INTEGER NOT NULL,
      PRIMARY KEY (rodada, atleta_id, codigo)
    );

    -- App state (key-value) — singletons, caches pequenos, configs.
    -- Engole: rodada_atual, simulando, classificacao, mercado_cache,
    -- mercado_status_cache, draft_meta, draft_ordem, draft_dias,
    -- partidas_cache, sim_scout, sim_partidas, email_map, oauth_state.
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Detecta versão real: se user_version=0 mas tabelas v1 existem,
  // marca como v1 pra migrateIfNeeded rodar. Tabelas v1 que NÃO existem
  // em v2: time_visual, melhor_time, simulando, rodada_atual, etc.
  if (getUserVersion(db) === 0) {
    if (hasTable(db, "time_visual") || hasTable(db, "rodada_atual")) {
      setUserVersion(db, 1);
    } else {
      // Banco novo — já é v2
      setUserVersion(db, SCHEMA_VERSION);
    }
  }
}

// ============================================================
// MIGRATION v1 → v2 (in-place)
// ============================================================

function migrateIfNeeded(db: Database): void {
  const version = getUserVersion(db);
  if (version < SCHEMA_VERSION) {
    console.log(`[db] migrating schema v${version} → v${SCHEMA_VERSION}…`);
    migrateV1toV2(db);
    setUserVersion(db, SCHEMA_VERSION);
    console.log(`[db] migration done`);
  }
  // Adições incrementais (idempotentes) — rodam sempre, mesmo em
  // bancos já no version atual. Útil pra columns adicionadas depois
  // sem bumpar SCHEMA_VERSION.
  ensureIncrementalColumns(db);
}

function ensureIncrementalColumns(db: Database): void {
  addColumnIfMissing(db, "sessions", "last_seen_at", "INTEGER");
  // Index criado AQUI (não em initSchema) porque depende da coluna
  // acima — em bancos v2 antigos a tabela já existe sem ela, então
  // a ordem importa: ALTER antes, CREATE INDEX depois.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at)",
  );
  // Histórico de logins — 1 row por usuário, atualizada em cada
  // login bem-sucedido. Usuário identificado por email (Google) ou
  // 'admin:<username>' pra login local. Independente de sessions
  // (que podem ser deletadas pra GC).
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_logins (
      user_key TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      chave TEXT,
      email TEXT,
      name TEXT,
      picture TEXT,
      last_login_at INTEGER NOT NULL,
      login_count INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_user_logins_last ON user_logins(last_login_at DESC)",
  );
  // Contador de trocas com o mercado por (chave, rodada). User-to-user
  // trocas são ilimitadas e não entram aqui — só swaps onde uma das
  // pontas é o pool de free agents (resolução de draft). Auto-reset
  // implícito: nova rodada → nova chave composta, count começa em 0.
  db.exec(`
    CREATE TABLE IF NOT EXISTS trocas_mercado (
      chave TEXT NOT NULL,
      rodada INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chave, rodada)
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_trocas_mercado_rodada ON trocas_mercado(rodada)",
  );

  // Ofertas user-to-user agora podem incluir trocas com mercado como
  // moeda extra (quem oferece passa N do seu saldo restante pro
  // destinatário). Coluna nova, default 0 = comportamento legacy.
  addColumnIfMissing(db, "ofertas", "trocas_oferecidas", "INTEGER NOT NULL DEFAULT 0");

  // Notificações ganham coluna mensagem pra suportar tipos sem oferta_id
  // (ex: troca_mercado broadcastada pra todos os times na resolução do
  // draft). Pra tipos legacy (oferta_*), mensagem fica NULL e UI cai no
  // join com ofertas.
  addColumnIfMissing(db, "notificacoes", "mensagem", "TEXT");

  // Snapshot da pontuação final de cada atleta por rodada. Antes só
  // tínhamos historico (totais por time) — pontos individuais vinham
  // sempre direto da Cartola via /atletas/pontuados/{rodada}. Agora
  // persiste local pra:
  //  - não depender de chamadas Cartola na abertura do modal de atleta
  //  - não perder histórico se Cartola mudar API
  // Cron escreve quando bola_rolando=false (rodada fechou).
  db.exec(`
    CREATE TABLE IF NOT EXISTS historico_atleta (
      atleta_id INTEGER NOT NULL,
      rodada INTEGER NOT NULL,
      pontos REAL NOT NULL,
      entrou_em_campo INTEGER,
      scout_json TEXT,
      PRIMARY KEY (atleta_id, rodada)
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_hist_atleta_rodada ON historico_atleta(rodada)",
  );
}

function hasTable(db: Database, name: string): boolean {
  const r = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name);
  return !!r;
}

function columnExists(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateV1toV2(db: Database): void {
  db.transaction(() => {
    // 0. Garante que colunas adicionadas pós-criação inicial existem
    addColumnIfMissing(db, "sessions", "last_seen_at", "INTEGER");
    addColumnIfMissing(db, "elencos", "nome_time_override", "TEXT");
    addColumnIfMissing(db, "elencos", "display_name_override", "TEXT");
    addColumnIfMissing(db, "elencos", "logo_override", "TEXT");
    addColumnIfMissing(db, "elencos", "visual_updated_at", "TEXT");
    addColumnIfMissing(db, "elencos", "melhor_time_json", "TEXT");
    addColumnIfMissing(db, "elencos", "subs_usadas_rodada", "INTEGER");
    addColumnIfMissing(
      db,
      "elencos",
      "subs_usadas_count",
      "INTEGER NOT NULL DEFAULT 0",
    );

    // 1. time_visual → colunas em elencos
    if (hasTable(db, "time_visual")) {
      const rows = db.prepare(
        "SELECT chave, nome_time, display_name, logo, updated_at FROM time_visual",
      ).all<{
        chave: string;
        nome_time: string | null;
        display_name: string | null;
        logo: string | null;
        updated_at: string | null;
      }>();
      const upd = db.prepare(
        "UPDATE elencos SET nome_time_override=?, display_name_override=?, logo_override=?, visual_updated_at=? WHERE chave=?",
      );
      for (const r of rows) {
        upd.run(r.nome_time, r.display_name, r.logo, r.updated_at, r.chave);
      }
      db.exec("DROP TABLE time_visual");
    }

    // 2. melhor_time → coluna em elencos
    if (hasTable(db, "melhor_time")) {
      const rows = db.prepare("SELECT chave, computed_json FROM melhor_time")
        .all<{ chave: string; computed_json: string }>();
      const upd = db.prepare("UPDATE elencos SET melhor_time_json=? WHERE chave=?");
      for (const r of rows) upd.run(r.computed_json, r.chave);
      db.exec("DROP TABLE melhor_time");
    }

    // 3. subs_usadas → colunas em elencos (mantém só a rodada mais recente
    // por chave; outras eram só histórico que o app não consulta)
    if (hasTable(db, "subs_usadas")) {
      const rows = db.prepare(
        "SELECT chave, MAX(rodada) AS rodada, count FROM subs_usadas GROUP BY chave",
      ).all<{ chave: string; rodada: number; count: number }>();
      const upd = db.prepare(
        "UPDATE elencos SET subs_usadas_rodada=?, subs_usadas_count=? WHERE chave=?",
      );
      for (const r of rows) upd.run(r.rodada, r.count, r.chave);
      db.exec("DROP TABLE subs_usadas");
    }

    // 4. Singletons + caches → app_state
    const moveToAppState = (
      sourceTable: string,
      stateKey: string,
      buildJson: () => string | null,
    ) => {
      if (!hasTable(db, sourceTable)) return;
      const json = buildJson();
      if (json !== null) {
        db.prepare(
          "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
        ).run(stateKey, json, Date.now());
      }
      db.exec(`DROP TABLE ${sourceTable}`);
    };

    moveToAppState("rodada_atual", "rodada_atual", () => {
      const r = db.prepare(
        "SELECT status, rodada, atualizado_em, fechamento_json FROM rodada_atual WHERE id=1",
      ).get<{
        status: string;
        rodada: number;
        atualizado_em: string | null;
        fechamento_json: string | null;
      }>();
      if (!r) return null;
      return JSON.stringify({
        status: r.status,
        rodada: r.rodada,
        atualizadoEm: r.atualizado_em ?? undefined,
        fechamento: r.fechamento_json ? JSON.parse(r.fechamento_json) : undefined,
      });
    });

    moveToAppState("simulando", "simulando", () => {
      const r = db.prepare("SELECT ativo FROM simulando WHERE id=1")
        .get<{ ativo: number }>();
      return JSON.stringify(r?.ativo === 1);
    });

    moveToAppState("classificacao", "classificacao", () => {
      const r = db.prepare("SELECT data_json FROM classificacao WHERE id=1")
        .get<{ data_json: string }>();
      return r?.data_json ?? null;
    });

    moveToAppState("mercado_cache", "mercado_cache", () => {
      const r = db.prepare("SELECT atletas_json FROM mercado_cache WHERE id=1")
        .get<{ atletas_json: string }>();
      return r?.atletas_json ?? null;
    });

    // mercado_status_cache tinha id=1 (status) e id=2 (partidas) — split
    if (hasTable(db, "mercado_status_cache")) {
      const rows = db.prepare(
        "SELECT id, data_json FROM mercado_status_cache",
      ).all<{ id: number; data_json: string }>();
      for (const r of rows) {
        const key = r.id === 2 ? "partidas_full_cache" : "mercado_status_cache";
        db.prepare(
          "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
        ).run(key, r.data_json, Date.now());
      }
      db.exec("DROP TABLE mercado_status_cache");
    }

    moveToAppState("draft_meta", "draft_meta", () => {
      const r = db.prepare(
        "SELECT ciclo, rodada_ciclo, rodada_base FROM draft_meta WHERE id=1",
      ).get<{ ciclo: number; rodada_ciclo: number; rodada_base: number }>();
      if (!r) return null;
      return JSON.stringify({
        ciclo: r.ciclo,
        rodadaCiclo: r.rodada_ciclo,
        rodadaBase: r.rodada_base,
      });
    });

    if (hasTable(db, "draft_ordem")) {
      const rows = db.prepare("SELECT chave FROM draft_ordem ORDER BY ordem")
        .all<{ chave: string }>();
      if (rows.length > 0) {
        db.prepare(
          "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
        ).run("draft_ordem", JSON.stringify(rows.map((r) => r.chave)), Date.now());
      }
      db.exec("DROP TABLE draft_ordem");
    }

    if (hasTable(db, "draft_dias")) {
      const rows = db.prepare("SELECT dia_semana FROM draft_dias ORDER BY dia_semana")
        .all<{ dia_semana: number }>();
      if (rows.length > 0) {
        db.prepare(
          "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
        ).run("draft_dias", JSON.stringify(rows.map((r) => r.dia_semana)), Date.now());
      }
      db.exec("DROP TABLE draft_dias");
    }

    if (hasTable(db, "partidas_cache")) {
      const rows = db.prepare("SELECT clube_id, casa, fora FROM partidas_cache")
        .all<{ clube_id: number; casa: string; fora: string }>();
      const map: Record<string, { casa: string; fora: string }> = {};
      for (const r of rows) map[String(r.clube_id)] = { casa: r.casa, fora: r.fora };
      if (rows.length > 0) {
        db.prepare(
          "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
        ).run("partidas_cache", JSON.stringify(map), Date.now());
      }
      db.exec("DROP TABLE partidas_cache");
    }

    moveToAppState("sim_scout", "sim_scout", () => {
      const r = db.prepare("SELECT data_json FROM sim_scout WHERE id=1")
        .get<{ data_json: string }>();
      return r?.data_json ?? null;
    });

    moveToAppState("sim_partidas", "sim_partidas", () => {
      const r = db.prepare("SELECT data_json FROM sim_partidas WHERE id=1")
        .get<{ data_json: string }>();
      return r?.data_json ?? null;
    });

    // 5. email_map → app_state["email_map"] (Record<email, chave>)
    if (hasTable(db, "email_map")) {
      const rows = db.prepare("SELECT email, chave FROM email_map")
        .all<{ email: string; chave: string }>();
      const map: Record<string, string> = {};
      for (const r of rows) map[r.email] = r.chave;
      db.prepare(
        "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
      ).run("email_map", JSON.stringify(map), Date.now());
      db.exec("DROP TABLE email_map");
    }

    // 6. oauth_state → app_state["oauth:<state>"]
    if (hasTable(db, "oauth_state")) {
      const rows = db.prepare("SELECT state, next, exp FROM oauth_state")
        .all<{ state: string; next: string; exp: number }>();
      for (const r of rows) {
        if (r.exp < Date.now()) continue; // skip expirado
        db.prepare(
          "INSERT OR REPLACE INTO app_state (key, data_json, updated_at) VALUES (?, ?, ?)",
        ).run(
          `oauth:${r.state}`,
          JSON.stringify({ next: r.next, exp: r.exp }),
          Date.now(),
        );
      }
      db.exec("DROP TABLE oauth_state");
    }
  })();
}
