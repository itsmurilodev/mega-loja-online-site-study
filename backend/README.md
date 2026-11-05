# Backend do Sistema Central de Click & Collect • Trabalho G2

Backend desenvolvido em **NestJS + TypeScript + Supabase (PostgreSQL)** para a disciplina de **Laboratório de Engenharia de Software** da Universidade LaSalle, estruturado em torno da Sprint do **Trabalho G2**.

## 1. Integrantes e Papéis (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Tecnologias e Arquitetura

- **NestJS 10 + TypeScript 5**: Arquitetura modular com injeção de dependências (`Modules`, `Controllers`, `Services`, `DTOs` e `ExceptionFilters`).
- **Supabase (`@supabase/supabase-js`)**: Banco de dados PostgreSQL gerenciado em nuvem com *Row Level Security (RLS)* ativo e chaves estrangeiras indexadas.
- **Padrão BCE (*Boundary, Control, Entity*)**:
  - *Boundary*: Controllers REST (`AppController`, `StoresController`, `ProductsController`, `OrdersController`) e filtro global `AllExceptionsFilter`.
  - *Control*: `OrdersService` orquestrando os casos de uso da sprint.
  - *Entity / Sistemas Externos*: `SupabaseService`, `StoresService` (Sistema de Estoque - S.E.) e `OperadoraCartaoService` (Operadora de Cartão).
- **Serverless Ready**: Compatível com deploy na Vercel via `api/index.ts` e `vercel.json`.

---

## 3. Estrutura de Pastas

```text
backend/
├── README.md                            # Documentação técnica do backend
├── supabase_schema.sql                  # Schema DDL PostgreSQL, índices e políticas RLS
└── src/
    ├── main.ts                          # Bootstrap do servidor NestJS (127.0.0.1:5000)
    ├── app.module.ts                    # Módulo raiz (Root Module)
    ├── app.controller.ts                # Serve front.html na raiz (/) e expõe /api e /api/health
    ├── app.service.ts                   # Diagnóstico e metadados da API
    ├── common/
    │   ├── constants.ts                 # Variáveis de ambiente, constantes e interfaces TypeScript
    │   └── filters/
    │       └── all-exceptions.filter.ts # Padroniza erros HTTP no formato { "error": "..." }
    ├── supabase/
    │   ├── supabase.module.ts           # Módulo global (@Global) do Supabase
    │   └── supabase.service.ts          # Cliente @supabase/supabase-js conectado ao PostgreSQL
    ├── stores/
    │   ├── stores.module.ts
    │   ├── stores.controller.ts         # GET /api/stores
    │   └── stores.service.ts            # Filiais + SistemaEstoqueService (UC002, reserva, devolução e ruptura)
    ├── products/
    │   ├── products.module.ts
    │   ├── products.controller.ts       # GET /api/products
    │   └── products.service.ts          # Consulta ao catálogo no Supabase (nome, preço, image_url, SKU, barcode)
    ├── payments/
    │   ├── payments.module.ts
    │   └── operadora-cartao.service.ts  # OperadoraCartaoService (Ator 4 - RF003, aprovação e recusa 402)
    └── orders/
        ├── orders.module.ts
        ├── orders.controller.ts         # Endpoints REST de pedidos e notificações
        ├── orders.service.ts            # Casos de Uso UC003, UC005, UC007, UC008 e Regra de Abandono
        └── dto/
            └── order.dto.ts             # DTOs tipados para operações de pedidos
```

---

## 4. Schema do Banco de Dados no Supabase (`public`)

- **`public.stores`**: Filiais físicas (`id`, `name`, `city`, `zip_code`, `address`, `capacity`, `active`).
- **`public.products`**: Catálogo de produtos (`id`, `name`, `category`, `price`, `image_url`, `sku`, `barcode`).
- **`public.inventory`**: Estoque por filial e produto (`store_id`, `product_id`, `quantity`).
- **`public.orders`**: Pedidos Click & Collect (`id`, `customer_name`, `customer_cpf`, `delivery_method`, `store_id`, `product_id`, `quantity`, `status`, `pickup_code`, `card_number_masked`, `payment_status`, `third_party_name`, `third_party_cpf`, `discount_coupon`, `refund_requested`, `cancellation_reason`, `created_at`, `updated_at`).
- **`public.notifications`**: Notificações operacionais e do cliente (`id`, `order_id`, `message`, `created_at`).

---

## 5. Como Executar Localmente

Na raiz do projeto:

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar o servidor NestJS em modo watch (desenvolvimento)
npm run start:dev
```

Comandos adicionais disponíveis no `package.json`:
- `npm start`: Inicia o servidor NestJS.
- `npm run build`: Compila o projeto TypeScript para `dist/`.
- `npm run start:prod`: Executa a versão compilada (`node dist/backend/src/main.js`).

A aplicação e a API estarão disponíveis em:
- **Interface Web (`front.html`)**: `http://127.0.0.1:5000/`
- **Índice da API**: `http://127.0.0.1:5000/api`
- **Health Check**: `http://127.0.0.1:5000/api/health`

---

## 6. Endpoints da API

| Método | Endpoint | Caso de Uso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | - | Diagnóstico de integridade da API e conexão Supabase |
| `GET` | `/api/stores` | RF001 / UC002 | Lista filiais ativas (aceita `?city=` e `?product_id=` para estoque) |
| `GET` | `/api/products` | RF002 | Lista produtos do Supabase com `price`, `image_url`, `sku` e `barcode` |
| `GET` | `/api/orders` | RF005 | Lista pedidos com join de produto e filial (`?store_id=` e `?status=`) |
| `GET` | `/api/orders/:id` | RF005 | Detalhes completos de um pedido específico |
| `GET` | `/api/orders/:id/notifications` | RF004 | Histórico de notificações do pedido |
| `POST` | `/api/orders` | **UC003** | Finalizar compra, validar estoque (UC002), cobrar cartão e reservar item |
| `POST` | `/api/orders/:id/separate` | **UC005** | Conferir SKU/código de barras, embalar e gerar QR Code assinado (UC006) |
| `POST` | `/api/orders/:id/rupture` | **UC008** | Registrar ruptura na prateleira, zerar estoque local e solicitar estorno |
| `POST` | `/api/orders/validate-pickup` | **UC007** | Validar retirada presencial (QR Code ou CPF) com conferência de documento |
| `POST` | `/api/orders/:id/expire` | Abandono | Expirar pedido por não-comparecimento (7 dias) e devolver item ao estoque |
| `PATCH` | `/api/orders/:id/status` | Compatibilidade | Atualização genérica de status delegando para os casos de uso oficiais |
