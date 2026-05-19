// SQLite singleton + schema. Substitui Deno KV.
//
// Por que SQLite direto e não Deno KV:
//   - Limite 64KB do KV (cache de mercado já estourou)
//   - Queries com índices custom (rankings, filtros admin)
//   - Schema explícito, tipado
//   - Ferramentas externas (sqlite3 CLI, DBeaver) leem direto
//
// Path do banco vem de DB_PATH env (prod = /data/app.db).
// Em dev sem env, usa ./data/app.db relativo ao cwd.

import { Database } from "@db/sqlite";

const DEFAULT_PATH = "./data/app.db";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const path = Deno.env.get("DB_PATH") || DEFAULT_PATH;
  // Garante que o dir existe (best-effort; ignora se já existe).
  try {
    const dir = path.replace(/\/[^/]+$/, "");
    if (dir && dir !== path) Deno.mkdirSync(dir, { recursive: true });
  } catch (_) { /* já existe */ }
  _db = new Database(path);
  // Pragmas pra perf e correção:
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA synchronous = NORMAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");
  initSchema(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ============================================================
// SCHEMA — idempotente, roda no startup
// ============================================================

function initSchema(db: Database): void {
  db.exec(`
    -- Elencos: 1 linha por time
    CREATE TABLE IF NOT EXISTS elencos (
      chave TEXT PRIMARY KEY,
      nome_time TEXT NOT NULL,
      dono TEXT NOT NULL
    );

    -- Jogadores: 1 linha por (chave, atleta_id). PK composta.
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

    -- Histórico de pontos por rodada
    CREATE TABLE IF NOT EXISTS historico (
      chave TEXT NOT NULL,
      rodada INTEGER NOT NULL,
      pontos REAL NOT NULL,
      PRIMARY KEY (chave, rodada)
    );

    -- Email map: email Google → chave do time
    CREATE TABLE IF NOT EXISTS email_map (
      email TEXT PRIMARY KEY,
      chave TEXT NOT NULL
    );

    -- Sessões ativas
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user','admin')),
      chave TEXT,
      email TEXT,
      name TEXT,
      picture TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- OAuth state (CSRF, TTL curto)
    CREATE TABLE IF NOT EXISTS oauth_state (
      state TEXT PRIMARY KEY,
      next TEXT NOT NULL,
      exp INTEGER NOT NULL
    );

    -- Rodada atual (singleton — sempre id=1)
    CREATE TABLE IF NOT EXISTS rodada_atual (
      id INTEGER PRIMARY KEY CHECK (id=1),
      status TEXT NOT NULL CHECK (status IN ('aguardando','aguardando_inicio','ao_vivo')),
      rodada INTEGER NOT NULL,
      atualizado_em TEXT,
      fechamento_json TEXT
    );

    -- "Está simulando rodada?" (singleton boolean)
    CREATE TABLE IF NOT EXISTS simulando (
      id INTEGER PRIMARY KEY CHECK (id=1),
      ativo INTEGER NOT NULL DEFAULT 0
    );

    -- Cache de atletas (1 linha por atleta, sem chunking por posição)
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

    -- Partidas (clube_id → casa+fora abreviado)
    CREATE TABLE IF NOT EXISTS partidas_cache (
      clube_id INTEGER PRIMARY KEY,
      casa TEXT NOT NULL,
      fora TEXT NOT NULL
    );

    -- Melhor time computado (cache — escalação com auto-subs aplicadas)
    CREATE TABLE IF NOT EXISTS melhor_time (
      chave TEXT PRIMARY KEY,
      computed_json TEXT NOT NULL
    );

    -- À venda (negociáveis) — 1 linha por atleta_id; chave indica dono
    CREATE TABLE IF NOT EXISTS a_venda (
      atleta_id INTEGER PRIMARY KEY,
      chave TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_a_venda_chave ON a_venda(chave);

    -- Interesses de draft (1 linha por (chave_ofertante, atleta_alvo))
    CREATE TABLE IF NOT EXISTS interesses (
      chave TEXT NOT NULL,
      atleta_alvo INTEGER NOT NULL,
      atleta_oferecido INTEGER NOT NULL,
      criado_em INTEGER NOT NULL,
      PRIMARY KEY (chave, atleta_alvo)
    );
    CREATE INDEX IF NOT EXISTS idx_interesses_alvo ON interesses(atleta_alvo);

    -- Substituições já usadas na rodada ao_vivo
    CREATE TABLE IF NOT EXISTS subs_usadas (
      rodada INTEGER NOT NULL,
      chave TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (rodada, chave)
    );

    -- Visual override (logo + nome + displayName)
    CREATE TABLE IF NOT EXISTS time_visual (
      chave TEXT PRIMARY KEY,
      nome_time TEXT,
      display_name TEXT,
      logo TEXT,
      updated_at TEXT
    );

    -- Ofertas + tabelas filhas pra atletas múltiplos
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

    -- Notificações
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

    -- Histórico de trocas (admin pode desfazer)
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

    -- Estado do scout (último valor visto por código → pra diff)
    CREATE TABLE IF NOT EXISTS scout_estado (
      rodada INTEGER NOT NULL,
      atleta_id INTEGER NOT NULL,
      codigo TEXT NOT NULL,
      qtd INTEGER NOT NULL,
      PRIMARY KEY (rodada, atleta_id, codigo)
    );

    -- Mercado cache (sem limite de 64KB agora — JSON livre)
    CREATE TABLE IF NOT EXISTS mercado_cache (
      id INTEGER PRIMARY KEY CHECK (id=1),
      atualizado_em TEXT NOT NULL,
      atletas_json TEXT NOT NULL
    );

    -- Classificação (singleton — JSON externo via n8n)
    CREATE TABLE IF NOT EXISTS classificacao (
      id INTEGER PRIMARY KEY CHECK (id=1),
      data_json TEXT NOT NULL
    );

    -- Configuração do draft
    CREATE TABLE IF NOT EXISTS draft_dias (
      dia_semana INTEGER PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6)
    );

    CREATE TABLE IF NOT EXISTS draft_ordem (
      chave TEXT PRIMARY KEY,
      ordem INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_draft_ordem ON draft_ordem(ordem);

    -- Prioridades pessoais (cada user lista preferências no draft)
    CREATE TABLE IF NOT EXISTS prioridades (
      chave TEXT NOT NULL,
      atleta_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      PRIMARY KEY (chave, atleta_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prioridades ON prioridades(chave, ordem);

    -- Cache do mercado/status da Cartola (singleton)
    CREATE TABLE IF NOT EXISTS mercado_status_cache (
      id INTEGER PRIMARY KEY CHECK (id=1),
      atualizado_em TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    -- Metadata do draft (singleton)
    CREATE TABLE IF NOT EXISTS draft_meta (
      id INTEGER PRIMARY KEY CHECK (id=1),
      ciclo INTEGER NOT NULL,
      rodada_ciclo INTEGER NOT NULL,
      rodada_base INTEGER NOT NULL
    );

    -- Simulação de rodada (admin) — scout + partidas falsas
    CREATE TABLE IF NOT EXISTS sim_scout (
      id INTEGER PRIMARY KEY CHECK (id=1),
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sim_partidas (
      id INTEGER PRIMARY KEY CHECK (id=1),
      data_json TEXT NOT NULL
    );
  `);
}
