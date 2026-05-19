# Draft de Free Agents — estado atual e decisões pendentes

Documenta o que já foi decidido e implementado pra resolução de interesses sobre
free agents. Foi pausado pra retomar depois — a parte de **resolução
automática** ainda não foi feita.

## Regras decididas

### Ordem do draft (quem pega primeiro)

- **Inicialização**: ordem = inverso da classificação acumulada (pior pontuação
  total → 1º pick). Computado por `inverseRankingOrdem()` em `lib/draft.ts`.
- **A cada rodada do Brasileirão**:
  - Quem **não usou** o pick sobe (mantendo ordem relativa entre si).
  - Quem **usou** vai pro fim da fila (mantendo ordem relativa entre si).
  - Implementado em `aplicarShift()` em `lib/draft.ts`.
- **Ciclo de 5 rodadas**: depois da 5ª rodada do ciclo (`rodadaCiclo > 5`), a
  ordem **reseta** pro inverso da classificação atual, `ciclo += 1`.
  Implementado em `avancarRodadaDraft()` em `lib/draft.ts`.
- **Default**: caso o draft não tenha sido inicializado, o handler do `/mercado`
  chama `inicializarDraftSeNecessario()` no primeiro acesso.

### Interesse num free agent

- Demonstrar interesse **exige** oferecer (empenhar) um jogador da mesma
  posição. Validado no `POST /api/atleta/[id]/interesse`.
- Cada user mantém sua própria **lista de prioridade** dos interesses que ele
  tem ativos (`["minha_prioridade", chave]` no KV).
  - Append automático quando marca interesse.
  - Remove quando desiste.
  - Reorder via `POST /api/me/prioridade { ordem: number[] }`.

### Resolução de conflitos

- **Entre times**: posição do draft decide (quem está mais alto leva).
- **Empate do mesmo time** (vários interesses, mas pode pegar só um): a
  prioridade pessoal do user define qual.
- **Quando resolve**: admin configura os dias da semana
  (`["draft_dias_resolucao"]`, default = `[3]` quarta). Próxima resolução =
  23:59 do próximo dia configurado. Editável em `/admin` ou via
  `POST /api/admin/draft-dias`.

### UI

Tudo no `/mercado`:

- **Pills no header** (`renderTimingPills` em `routes/mercado.tsx`):
  - `MKT 4D` — quanto falta pro mercado fechar (timestamp do Cartola)
  - `DRAFT 4D` — quanto falta pra próxima resolução
  - Cores: cinza normal · amarelo `<24h` · vermelho `<6h`
- **Stats bar** (3 botões): `N à venda · N interesses · Nº draft · R3/5`
  - Clicar em "à venda" filtra grid pros meus jogadores à venda.
  - Clicar em "interesses" abre modal pra reordenar.
  - Clicar no "Nº draft" abre modal com a ordem completa + ciclo.

## Schema KV

| Chave                         | Valor                                            |
| ----------------------------- | ------------------------------------------------ |
| `["draft_ordem"]`             | `string[]` — chaves em ordem (index 0 = 1º pick) |
| `["draft_meta"]`              | `{ ciclo, rodadaCiclo, rodadaBase }`             |
| `["draft_dias_resolucao"]`    | `number[]` (0=dom..6=sáb)                        |
| `["interessados", atletaId]`  | `Array<{ chave: string; oferecido: number }>`    |
| `["minha_prioridade", chave]` | `number[]` — atleta_ids em ordem de prioridade   |
| `["a_venda", chave]`          | `number[]` — atleta_ids que o time botou à venda |

## Endpoints implementados

| Método | Path                         | Quem   | Descrição                                         |
| ------ | ---------------------------- | ------ | ------------------------------------------------- |
| POST   | `/api/atleta/[id]/interesse` | user   | body: `{ atleta_oferecido }` ou `{ remover }`     |
| GET    | `/api/me/prioridade`         | user   | retorna `{ ordem: number[] }`                     |
| POST   | `/api/me/prioridade`         | user   | body: `{ ordem: number[] }` reordena              |
| GET    | `/api/admin/draft-ordem`     | logado | retorna ordem atual                               |
| POST   | `/api/admin/draft-ordem`     | admin  | seta nova ordem (override manual)                 |
| POST   | `/api/admin/draft-fechar`    | admin  | body: `{ pickers: chave[] }` ou `{ reset: true }` |
| GET    | `/api/admin/draft-dias`      | logado | retorna `{ dias: number[] }`                      |
| POST   | `/api/admin/draft-dias`      | admin  | seta dias da semana                               |

## O que falta (TODO quando retomar)

- **Resolução automática**: endpoint admin que pega cada free agent com
  interessados e distribui pela ordem do draft + prioridade pessoal.
  - Para cada free agent: encontrar o time mais alto no draft que ainda tenha
    esse atleta no top da sua prioridade pessoal.
  - Mover o atleta pro elenco vencedor.
  - Mover o jogador oferecido pro pool de free agents.
  - Marcar o time como "usou pick essa rodada" (pra próximo shift).
  - Limpar interesses resolvidos.
- **Auto-shift na virada de rodada do Brasileirão**: detectar quando
  `rodada_atual` muda no KV (no cron `atualizarTudo`) e chamar
  `avancarRodadaDraft()` automaticamente — hoje só rola se admin clicar.
- **Validação de unicidade**: garantir que um jogador oferecido só pode aparecer
  em **um** registro de interesse por vez (hoje o user pode oferecer o mesmo
  jogador pra múltiplos free agents).
- **Notificações**: avisar usuários quando o draft resolve seus interesses
  (ganhou X / perdeu Y).
- **Histórico**: log de resoluções pra mostrar "Quem pegou quem" por rodada.
  Útil pra contestar e pra UX retrospectiva.
- **Lock de jogador oferecido**: o jogador empenhado deveria ficar "trancado"
  (não pode ser usado em escalação? não pode ser vendido? decisão de UX).
- **UI admin pra resolução**: dashboard mostrando todos os interesses ativos por
  free agent + botão "Resolver agora" que aplica a regra.
- **UI admin pra reordenar draft manualmente**: drag-drop em vez de curl pra
  `/api/admin/draft-ordem`.

## Arquivos relevantes

```
lib/draft.ts                     — lógica de ordem, shift, reset, dias
lib/kv.ts                        — get/setMinhaPrioridade, getInteressados
routes/mercado.tsx               — handler que computa tudo
islands/MercadoBrowser.tsx       — UI (stats bar, modal interesses, modal draft)
islands/AdminDraftDias.tsx       — chips dos dias da semana
routes/admin.tsx                 — página admin
routes/api/admin/draft-*.ts      — endpoints admin
routes/api/atleta/[id]/interesse.ts
routes/api/me/prioridade.ts
```
