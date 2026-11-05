# Backend do Sistema Central de Click & Collect • Trabalho G2

Backend desenvolvido em **NestJS + TypeScript + Supabase** para a disciplina de **Laboratório de Engenharia de Software** da Universidade LaSalle, estruturado em torno da Sprint do **Trabalho G2**.

## 1. Integrantes e Papéis (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Estrutura de Pastas (NestJS Modular)

```text
backend/
├── supabase_schema.sql                  # DDL e Seed inicial do Supabase (PostgreSQL)
└── src/
    ├── main.ts                          # Bootstrap da aplicação NestJS (127.0.0.1:5000)
    ├── app.module.ts                    # Módulo raiz (Root Module)
    ├── app.controller.ts                # Rotas de diagnóstico (/api e /api/health)
    ├── app.service.ts
    ├── common/
    │   ├── constants.ts                 # Constantes de domínio e interfaces TypeScript
    │   └── filters/
    │       └── all-exceptions.filter.ts # Filtro global de exceções ({ error: message })
    ├── supabase/
    │   ├── supabase.module.ts           # Módulo global de conexão ao Supabase
    │   └── supabase.service.ts          # Cliente Supabase + Seed automático (OnModuleInit)
    ├── stores/
    │   ├── stores.module.ts
    │   ├── stores.controller.ts         # GET /api/stores
    │   └── stores.service.ts            # Lojas + SistemaEstoqueService (UC002, reserva, baixa, ruptura)
    ├── products/
    │   ├── products.module.ts
    │   ├── products.controller.ts       # GET /api/products
    │   └── products.service.ts          # Catálogo de produtos com SKU e código de barras
    ├── payments/
    │   ├── payments.module.ts
    │   └── operadora-cartao.service.ts  # OperadoraCartaoService (Ator 4 - RF003)
    └── orders/
        ├── orders.module.ts
        ├── orders.controller.ts         # Endpoints UC003, UC005, UC007, UC008 e Abandono
        ├── orders.service.ts            # Regras de negócio de pedidos e notificações
        └── dto/
            └── order.dto.ts             # DTOs de entrada tipados
```

---

## 3. Casos de Uso Contemplados

- **UC003 - Finalizar Compra** (`POST /api/orders`):
  - Consulta obrigatória de estoque em tempo real na filial (UC002).
  - Aplicação automática de frete R$ 0,00.
  - Processamento financeiro com a Operadora de Cartão (RF003).
  - Suporte a autorização de terceiro para retirada (Fluxo 5.3.5.1).
  - Simulação de recusa de transação (Fluxo 5.1.5.2).
  - Status inicial: `aguardando_separacao`.
- **UC005 - Separar Pedido** (`POST /api/orders/:id/separate`):
  - Painel de separação por filial com ordenação de pedidos.
  - Leitura ótica de código de barras ou digitação manual de SKU (Fluxo 5.2.5.2).
  - Status atualizado para `pronto_retirada` e geração do voucher/QR Code seguro (UC006 / RNF003).
- **UC008 - Registrar Ruptura de Estoque** (`POST /api/orders/:id/rupture`):
  - Acionado em caso de falta de item físico na prateleira (Fluxo 5.2.5.1).
  - Status atualizado para `cancelado_ruptura`.
  - Disparo de solicitação de estorno à operadora financeira e ajuste de estoque para zero.
- **UC007 - Validar Retirada** (`POST /api/orders/validate-pickup`):
  - Validação no balcão por leitura de QR Code ou busca manual por CPF/Pedido (Fluxo 5.3.5.2).
  - Conferência de documento físico (titular ou terceiro autorizado cadastrado).
  - Status final: `entregue_cliente`.

---

## 4. Como Configurar e Executar

1. No painel do seu projeto no **Supabase**, abra o **SQL Editor** e execute o script `backend/supabase_schema.sql`.
2. Copie o arquivo `.env.example` para `.env` na raiz do projeto e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`).
3. Instale as dependências e inicie o servidor NestJS:

```bash
npm install
npm run start:dev
```

A API iniciará em `http://127.0.0.1:5000`.
