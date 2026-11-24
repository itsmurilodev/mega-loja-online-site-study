# Backend do Sistema Central de Click & Collect • Trabalho G2

Backend desenvolvido em **NestJS + TypeScript + Supabase (PostgreSQL)** para a disciplina de **Laboratório de Engenharia de Software** da Universidade LaSalle, estruturado em torno das Sprints do **Trabalho G2**.

## 1. Integrantes e Papéis (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Tecnologias, Segurança e Telemetria (Sprint 3)

- **NestJS 10 + TypeScript 5**: Arquitetura modular com injeção de dependências (`Modules`, `Controllers`, `Services`, `DTOs`, `Interceptors` e `ExceptionFilters`).
- **Supabase (`@supabase/supabase-js`)**: Banco de dados PostgreSQL gerenciado em nuvem com *Row Level Security (RLS)* ativo e chaves estrangeiras indexadas.
- **Sprint 3 — HTTPS em Demo, Segredos Fora do Código e Medição RNF001 ($\le$ 60s)**:
  - *Critério de aceite a detalhar no Planning da Sprint 3.*
  - **Segredos Fora do Código (RNF002/RNF003)**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` e `SECRET_TOKEN_KEY` lidos exclusivamente de variáveis de ambiente (`.env` / Vercel Env Vars), sem chaves hardcoded no código-fonte.
  - **HTTPS em Ambiente de Demo (RNF002)**: Cabeçalho `Strict-Transport-Security` (HSTS) em `vercel.json` e `RnfMetricsInterceptor`, validação `FORCE_HTTPS` e suporte a certificados TLS locais (`HTTPS_KEY_PATH` e `HTTPS_CERT_PATH`).
  - **Medição de Consulta/Reserva de Estoque $\le$ 60s (RNF001)**: `RnfMetricsService` e `RnfMetricsInterceptor` medem em milissegundos (`performance.now()`) todas as operações de `consulta_estoque` (UC002) e `reserva_estoque` (UC003), expondo métricas em `GET /api/metrics/rnf001`, `GET /api/health`, cabeçalhos HTTP (`X-Response-Time-Ms`, `X-RNF001-Compliant`) e campo `rnf001_telemetry`.

---

## 3. Estrutura de Pastas

```text
backend/
├── README.md                                    # Documentação técnica do backend
├── supabase_schema.sql                          # Schema DDL PostgreSQL, índices e políticas RLS
└── src/
    ├── main.ts                                  # Bootstrap do servidor NestJS (HTTP/HTTPS)
    ├── app.module.ts                            # Módulo raiz (Root Module)
    ├── app.controller.ts                        # Rotas /, /api, /api/health e /api/metrics/rnf001
    ├── app.service.ts                           # Diagnóstico, segurança RNF002 e SLA RNF001
    ├── common/
    │   ├── constants.ts                         # Variáveis de ambiente, constantes e tipos
    │   ├── filters/
    │   │   └── all-exceptions.filter.ts         # Padroniza erros HTTP no formato { "error": "..." }
    │   ├── interceptors/
    │   │   └── rnf-metrics.interceptor.ts       # HSTS, verificação HTTPS e medição RNF001 (<= 60s)
    │   └── metrics/
    │       ├── rnf-metrics.module.ts            # Módulo global de telemetria RNF001
    │       └── rnf-metrics.service.ts           # Histórico e estatísticas de consulta/reserva de estoque
    ├── supabase/
    │   ├── supabase.module.ts                   # Módulo global (@Global) do Supabase
    │   └── supabase.service.ts                  # Cliente @supabase/supabase-js conectado ao PostgreSQL
    ├── stores/
    │   ├── stores.module.ts
    │   ├── stores.controller.ts                 # GET /api/stores
    │   └── stores.service.ts                    # Filiais + SistemaEstoqueService (UC002, reserva, devolução e ruptura)
    ├── products/
    │   ├── products.module.ts
    │   ├── products.controller.ts               # GET /api/products
    │   └── products.service.ts                  # Consulta ao catálogo no Supabase (nome, preço, image_url, SKU, barcode)
    ├── payments/
    │   ├── payments.module.ts
    │   └── operadora-cartao.service.ts          # OperadoraCartaoService (Ator 4 - RF003, aprovação e recusa 402)
    └── orders/
        ├── orders.module.ts
        ├── orders.controller.ts                 # Endpoints REST de pedidos e notificações
        ├── orders.service.ts                    # Casos de Uso UC003, UC005, UC007, UC008 e Regra de Abandono
        └── dto/
            └── order.dto.ts                     # DTOs tipados para operações de pedidos
```

---

## 4. Endpoints da API

| Método | Endpoint | Caso de Uso / RNF | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | **RNF001 / RNF002** | Diagnóstico de integridade, verificação de segredos e resumo do SLA RNF001 |
| `GET` | `/api/metrics/rnf001` | **RNF001 ($\le$ 60s)** | Relatório detalhado de tempos de resposta de consulta e reserva de estoque |
| `GET` | `/api/stores` | RF001 / UC002 | Lista filiais ativas (aceita `?city=` e `?product_id=` para estoque) |
| `GET` | `/api/products` | RF002 | Lista produtos do Supabase com `price`, `image_url`, `sku` e `barcode` (`?include=stock` traz o estoque de todas as filiais em `stocks`) |
| `POST` | `/api/products` | **S3-08** · papel `empresa` | Cria produto (nome, categoria, preço > 0, SKU único, código de barras, link da imagem e `stock` por filial) |
| `PATCH` | `/api/products/:id` | **S3-08** · papel `empresa` | Altera preço, imagem, SKU, categoria e estoque por filial |
| `POST` | `/api/auth/login` | **S3-07** | Login pelo Supabase Auth (`portal: "operador"` só aceita operador/empresa); devolve `access_token` e o usuário |
| `POST` | `/api/auth/register` | **S3-07** | Cria conta de **cliente** (sempre com esse papel) |
| `GET` | `/api/auth/me` | **S3-07** | Usuário do token enviado em `Authorization: Bearer` |
| `POST` | `/api/orders/checkout` | **S3-30** | Carrinho com vários itens: confere todo o estoque, cobra uma vez e cria um pedido por item |
| `GET` | `/api/orders/mine` | S3-27 · papel `cliente` | Pedidos do cliente logado (pelo CPF do cadastro) |
| `GET` | `/api/orders` | RF005 · papel `operador`/`gerente`/`empresa` | Lista pedidos com join de produto e filial (`?store_id=` e `?status=`) |
| `GET` | `/api/orders/:id` | RF005 · **privacidade** | Detalhes de um pedido. Exige login de colaborador, login do cliente dono (mesmo CPF) ou o cabeçalho `X-Order-Token` devolvido pela compra (`401` sem nada disso) |
| `GET` | `/api/orders/:id/notifications` | RF004 · **privacidade** | Histórico de notificações do pedido (mesma regra de acesso) |
| `POST` | `/api/orders/quote` | **S3-23** | Total a pagar (itens + frete simulado), sem criar nada |
| `POST` | `/api/orders/third-party-code` | **S3-18** | Gera o código de confirmação do terceiro (envio por e-mail **simulado**) |
| `POST` | `/api/payments/pix` | **S3-23** | Cobrança Pix **simulada** (token assinado, expira em 5 min) |
| `GET` | `/api/orders/pickup-slots` | **S3-22** | Janelas de retirada do dia e vagas por janela (precisa da migração 001) |
| `GET` | `/api/stores/:id/transfer-options` | **S3-25** | Filiais/CD que podem enviar o item e o novo prazo |
| `POST` | `/api/orders/expire-overdue` | **S3-24** · `gerente`/`empresa` | Libera as reservas vencidas e devolve o estoque |
| `GET` | `/api/orders/:id/audit` | **S3-17** · staff | Histórico de ações dos colaboradores no pedido |
| `GET` | `/api/audit` | **S3-17** · `gerente`/`empresa` | Log de auditoria geral |
| `POST` | `/api/orders` | **UC003 / RNF001** | Finalizar compra, validar/reservar estoque ($\le$ 60s) e cobrar cartão |
| `POST` | `/api/orders/:id/separate` | **UC005 / RNF003** | Conferir SKU/código de barras, embalar e gerar QR Code assinado |
| `POST` | `/api/orders/:id/rupture` | **UC008** | Registrar ruptura na prateleira, zerar estoque local e solicitar estorno |
| `POST` | `/api/orders/validate-pickup` | **UC007** | Validar retirada presencial (QR Code ou CPF) com conferência de documento |
| `POST` | `/api/orders/:id/expire` | Abandono · `gerente`/`empresa` | Expirar pedido por não-comparecimento (7 dias) e devolver item ao estoque |
| `PATCH` | `/api/orders/:id/status` | Compatibilidade | Atualização genérica de status delegando para os casos de uso oficiais |

**Autenticação (S3-14 / S3-16):** `separate`, `rupture`, `validate-pickup` (e o alias `pickup`), `PATCH status` e a listagem `GET /api/orders` exigem `Authorization: Bearer <access_token>` de uma conta `operador`, `gerente` ou `empresa`; `expire`, `expire-overdue` e o cancelamento por `PATCH status` exigem `gerente` ou `empresa` (`401` sem token ou token inválido, `403` com papel errado). `POST/PATCH /api/products` exigem `empresa`. Criar pedido continua aberto para o cliente. Ler um pedido (nome, CPF, voucher) exige a chave de acesso que a própria compra devolve em `access_token` (enviada depois no cabeçalho `X-Order-Token`), ou login de colaborador, ou login do cliente dono do pedido. Contas de operador/empresa são criadas com `npm run seed:usuario` (ver README da raiz).
