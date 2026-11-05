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
| `GET` | `/api/products` | RF002 | Lista produtos do Supabase com `price`, `image_url`, `sku` e `barcode` |
| `GET` | `/api/orders` | RF005 | Lista pedidos com join de produto e filial (`?store_id=` e `?status=`) |
| `GET` | `/api/orders/:id` | RF005 | Detalhes completos de um pedido específico |
| `GET` | `/api/orders/:id/notifications` | RF004 | Histórico de notificações do pedido |
| `POST` | `/api/orders` | **UC003 / RNF001** | Finalizar compra, validar/reservar estoque ($\le$ 60s) e cobrar cartão |
| `POST` | `/api/orders/:id/separate` | **UC005 / RNF003** | Conferir SKU/código de barras, embalar e gerar QR Code assinado |
| `POST` | `/api/orders/:id/rupture` | **UC008** | Registrar ruptura na prateleira, zerar estoque local e solicitar estorno |
| `POST` | `/api/orders/validate-pickup` | **UC007** | Validar retirada presencial (QR Code ou CPF) com conferência de documento |
| `POST` | `/api/orders/:id/expire` | Abandono | Expirar pedido por não-comparecimento (7 dias) e devolver item ao estoque |
| `PATCH` | `/api/orders/:id/status` | Compatibilidade | Atualização genérica de status delegando para os casos de uso oficiais |
