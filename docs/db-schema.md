# Schema do banco — SQLite (`/data/app.db`)

**16 tabelas** (schema v2 — consolidado de 31). Diagrama renderiza
automaticamente no GitHub.

```mermaid
erDiagram
    %% ============================================================
    %% TIMES (elencos engloba time_visual + melhor_time + subs_usadas)
    %% ============================================================
    elencos ||--o{ jogadores : tem
    elencos ||--o{ a_venda : "marca negociável"
    elencos ||--o{ historico : "pontos por rodada"
    elencos ||--o{ prioridades : "lista pessoal"
    elencos ||--o{ interesses : "interessado em"
    elencos ||--o{ ofertas : "envia/recebe"
    elencos ||--o{ notificacoes : "destinatário"

    elencos {
        string chave PK
        string nome_time
        string dono
        string nome_time_override "override admin"
        string display_name_override "override admin"
        string logo_override "override admin"
        string visual_updated_at
        string melhor_time_json "cache escalação"
        int subs_usadas_rodada "rodada atual"
        int subs_usadas_count "subs banco↔escala usadas"
    }
    jogadores {
        string chave PK,FK
        int atleta_id PK
        string apelido_api
        string clube
        int clube_id
        string posicao
        int posicao_id
        string escalacao "Sim|Banco|Não"
        int status_id
        int provavel
        int lesionado
        int suspenso
        int nulo
        int entrou_em_campo
        string clube_casa
        string clube_fora
        real pontos
    }
    historico {
        string chave PK,FK
        int rodada PK
        real pontos
    }
    a_venda {
        int atleta_id PK
        string chave FK "dono"
    }
    prioridades {
        string chave PK,FK
        int atleta_id PK
        int ordem
    }
    interesses {
        string chave PK,FK
        int atleta_alvo PK
        int atleta_oferecido
        int criado_em
    }

    %% ============================================================
    %% OFERTAS (multi-jogador, junction tables preservadas)
    %% ============================================================
    ofertas ||--o{ oferta_oferecidos : "1-3 atletas"
    ofertas ||--o{ oferta_extras : "extras escolhidos pelo destinatário"
    ofertas ||--o{ notificacoes : "trigger"
    ofertas ||--o{ historico_trocas : "1 troca por par"

    ofertas {
        string id PK
        string de_chave FK
        string para_chave FK
        int atleta_pedido
        string status "pendente|aceita|negada|cancelada"
        int criado_em
        int respondido_em
        string mensagem
    }
    oferta_oferecidos {
        string oferta_id PK,FK
        int atleta_id PK
        int ordem
    }
    oferta_extras {
        string oferta_id PK,FK
        int atleta_id PK
        int ordem
    }
    notificacoes {
        string id PK
        string chave FK
        string tipo "oferta_recebida|aceita|negada"
        string oferta_id FK
        int lida
        int criado_em
    }
    historico_trocas {
        string id PK
        string oferta_id FK
        string chave_a FK
        int atleta_a_id
        string atleta_a_apelido
        string atleta_a_escalacao
        string chave_b FK
        int atleta_b_id
        string atleta_b_apelido
        string atleta_b_escalacao
        int criado_em
        int desfeito_em
    }

    %% ============================================================
    %% AUTH (sessions tabela, email_map e oauth_state em app_state)
    %% ============================================================
    sessions {
        string id PK
        string role "user|admin"
        string chave FK
        string email
        string name
        string picture
        int created_at
        int expires_at
    }

    %% ============================================================
    %% CACHES (Cartola)
    %% ============================================================
    atletas_cache {
        int atleta_id PK
        string apelido
        string clube
        int clube_id
        string posicao
        int posicao_id
        int status_id
        string foto
        string atualizado_em
    }

    %% ============================================================
    %% EVENTOS AO VIVO (cron polling do scout Cartola)
    %% ============================================================
    evento_hist {
        int rodada PK
        int ts PK
        int atleta_id PK
        string codigo PK "G,A,CA,CV,..."
        int qtd
    }
    scout_estado {
        int rodada PK
        int atleta_id PK
        string codigo PK
        int qtd "última qtd vista (pra diff)"
    }

    %% ============================================================
    %% APP STATE (key-value pra singletons, configs, caches pequenos)
    %% Engloba: rodada_atual, simulando, classificacao, mercado_cache,
    %% mercado_status_cache, partidas_full_cache, draft_meta,
    %% draft_ordem, draft_dias, sim_scout, sim_partidas, email_map,
    %% oauth:<state> (oauth state).
    %% ============================================================
    app_state {
        string key PK
        string data_json
        int updated_at
    }
```

## Notas

- **Versão do schema**: `PRAGMA user_version = 2`. Migration in-place do v1
  acontece automaticamente no startup (`lib/db.ts:migrateV1toV2`).
- **PK composta** em `jogadores`, `historico`, `prioridades`, `interesses`,
  `oferta_oferecidos`, `oferta_extras`, `evento_hist`, `scout_estado`.
- **Foreign keys** ativas (`PRAGMA foreign_keys = ON`) com `ON DELETE CASCADE`
  em jogadores → elencos e oferta_oferecidos/extras → ofertas.
- **Helpers**: `lib/app-state.ts` expõe `appStateGet/Set/Delete` pra qualquer
  consumidor. Usuários típicos: `getRodadaStatus`, `getDiasResolucao`,
  `fetchMercadoStatusCacheado`, `isSimulando`.
- **atletas_cache** não tem FK formal pra `jogadores.atleta_id` — jogadores
  podem existir no elenco sem estar no cache do mercado (transferidos pra
  outra liga, fora do Cartola).
- **Trade-off**: perdemos query rápida por email único (era `email_map(email PK)`).
  Agora `emailParaChave(email)` faz `appStateGet("email_map")` + lookup no
  Record JSON. Custo desprezível em ~9 emails.
