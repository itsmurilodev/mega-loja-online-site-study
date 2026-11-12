# MegaLoja Online • Sistema Central de Click & Collect

Projeto desenvolvido para a disciplina de **Laboratório de Engenharia de Software** da **Universidade LaSalle (Unilasalle)** — **Trabalho G2**.

O objetivo do sistema é unificar o ambiente de compras digitais ao estoque das lojas físicas, permitindo que o cliente compre pelo site e retire o produto diretamente em uma filial de sua preferência com frete grátis, validação segura por QR Code assinado via HMAC e integração em tempo real com **Supabase (PostgreSQL)** e operadora financeira.

---

## 1. Integrantes e Papéis no Projeto (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Stack Tecnológica e Arquitetura

- **Frontend (Boundary):** HTML5, TailwindCSS e JavaScript (`front.html`), consumindo a API REST de forma reativa.
- **Backend (Control):** **TypeScript** + **NestJS** (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`), estruturado de forma modular em `backend/src/`.
- **Banco de Dados em Nuvem (Entity):** **Supabase (PostgreSQL)** via `@supabase/supabase-js`, com *Row Level Security (RLS)* ativo e integridade referencial entre `stores`, `products`, `inventory`, `orders` e `notifications`.
- **Deploy Serverless & HTTPS:** Configurado para **Vercel** (`vercel.json` + `api/index.ts`) com cabeçalhos de segurança HSTS (`Strict-Transport-Security`).

---

## 3. Atores do Sistema

- **Ator 1: Cliente** — Usuário final que realiza a compra, seleciona a filial para retirada, recebe o QR Code e busca o produto na loja física.
- **Ator 2: Operador da Loja** — Funcionário responsável por receber o pedido no painel local, separar e embalar o produto no estoque físico e validar a entrega ao cliente.
- **Ator 3: Sistema de Estoque (S.E.)** — Ator externo/suporte que monitora e fornece a disponibilidade de itens por loja em tempo real no Supabase e registra a reserva, devolução e baixa física.
- **Ator 4: Operadora de Cartão** — Serviço externo responsável por receber os dados do cartão do cliente, processar a transação financeira em tempo real e retornar o status da cobrança (aprovado ou recusado).

---

## 4. Casos de Uso Detalhados (Sprint G2)

### UC003 - Finalizar Compra
- **Ator Principal:** Cliente
- **Relação de Inclusão (`<<include>>`):** `UC002 - Consultar Disponibilidade` obrigatória no S.E. (`StoresService.consultarDisponibilidade`).
- **Regras:** Aplica frete R$ 0,00, processa pagamento na Operadora de Cartão (RF003), reserva item na tabela `inventory` do Supabase e gera pedido em `orders` com status inicial `aguardando_separacao`.
- **Fluxos Alternativos:**
  - `5.1.5.1 Item indisponível na loja selecionada`: Retorna HTTP `409 Conflict`, alerta o cliente e sugere outra filial ou entrega domiciliar.
  - `5.1.5.2 Pagamento recusado`: Retorna HTTP `402 Payment Required`, informa falha na transação e solicita nova forma de pagamento.
  - `5.3.5.1 Retirada por terceiro autorizado`: Permite informar nome e CPF de quem retirará a encomenda.

### UC005 - Separar Pedido
- **Ator Principal:** Operador da Loja (Perfil Retaguarda)
- **Regras:** Painel local com ordenação de pedidos pendentes na filial, conferência de código de barras ou digitação manual de SKU (Fluxo 5.2.5.2) e embalagem.
- **Conclusão:** Status atualizado no Supabase para `pronto_retirada`, geração automática do QR Code assinado com HMAC-SHA256 (UC006 / RNF003) e registro de notificação ao cliente.
- **Ponto de Extensão (`<<extend>>`):** `UC008 - Registrar Ruptura (Falta de Item)`.

### UC008 - Registrar Ruptura (Falta de Item)
- **Ator Principal:** Operador da Loja
- **Regra:** Disparado quando o item físico não se encontra na prateleira (Fluxo 5.2.5.1). O pedido é cancelado (`cancelado_ruptura`), a solicitação de estorno (`refund_requested = 1`) é emitida à operadora de cartão e o estoque da filial no Supabase é corrigido para `0`.

### UC007 - Validar Retirada
- **Ator Principal:** Operador da Loja / Atendente de Balcão
- **Regras:** Escaneamento do QR Code com conferência obrigatória de documento físico com foto (titular ou terceiro previamente cadastrado).
- **Fluxo Alternativo 5.3.5.2 (QR Code ilegível/expirado):** Busca manual de contingência por CPF e número do pedido.
- **Conclusão:** Status final atualizado no Supabase para `entregue_cliente` e encerramento do ciclo de vida da transação.

---

## 5. Requisitos do Sistema & Entregas da Sprint 3

### Requisitos Funcionais (RFs)
- **RF001:** Seleção de Filial para Retirada durante o checkout (`GET /api/stores`).
- **RF002:** Consulta de Disponibilidade de Estoque em Tempo Real (`GET /api/products` e `GET /api/stores?product_id=...`).
- **RF003:** Processamento de Pagamento Online com frete gratuito (`OperadoraCartaoService`).
- **RF004:** Notificação e Envio de QR Code seguro após separação (`notifications`).
- **RF005:** Painel de Separação de Pedidos com leitura de código de barras/SKU (`POST /api/orders/:id/separate`).
- **RF006:** Registro de Ruptura de Estoque com cancelamento e estorno (`POST /api/orders/:id/rupture`).
- **RF007:** Validação Presencial da Retirada (`POST /api/orders/validate-pickup`).

### Requisitos Não Funcionais (RNFs) e Escopo da Sprint 3
- **Sprint 3:** HTTPS em ambiente de demo, segredos fora do código e medição de que consulta/reserva de estoque responde em até 60 s (**RNF001**). *Critério de aceite a detalhar no Planning da Sprint 3.*
  - **RNF001 (Medição de SLA $\le$ 60s):** Monitoramento em tempo real via `RnfMetricsService` e `RnfMetricsInterceptor` (`performance.now()`), expondo cabeçalhos HTTP (`X-Response-Time-Ms`, `X-RNF001-SLA-Limit-Ms: 60000`, `X-RNF001-Compliant`), objeto `rnf001_telemetry` nas respostas de consulta/reserva e endpoint dedicado `GET /api/metrics/rnf001`.
  - **RNF002 (HTTPS em Demo e Segredos Fora do Código):**
    - Todas as chaves sensíveis (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SECRET_TOKEN_KEY`) externalizadas exclusivamente em variáveis de ambiente (`.env` / Vercel Env Vars), sem chaves hardcoded no código-fonte.
    - Cabeçalho `Strict-Transport-Security` (HSTS) configurado em `vercel.json` e no `RnfMetricsInterceptor`, com bloqueio automático de requisições não-HTTPS quando `FORCE_HTTPS=true` e suporte a certificados TLS locais (`HTTPS_KEY_PATH` / `HTTPS_CERT_PATH`).
  - **RNF003:** Autenticidade do Voucher (QR Code assinado via HMAC-SHA256 contra fraudes).
  - **RNF004:** Operação Tolerante a Falhas (tratamento padronizado via `AllExceptionsFilter`).
  - **RNF005:** Acessibilidade do Painel (responsivo para coletores portáteis e terminais web).

---

## 6. Arquitetura BCE (Boundary, Control, Entity) no NestJS

Conforme modelado no Diagrama de Sequência do Trabalho G2:
- **Boundary (Fronteira):** `InterfaceCheckout` e `PainelBalcao` (`front.html`) + Controllers HTTP do NestJS (`StoresController`, `ProductsController`, `OrdersController`) + `RnfMetricsInterceptor`.
- **Control (Controle):** `OrdersService` (`backend/src/orders/orders.service.ts`), orquestrando os fluxos de negócio.
- **Entity / Sistemas Externos:**
  - `SupabaseService` (`backend/src/supabase/supabase.service.ts`) — Persistência PostgreSQL em nuvem.
  - `StoresService` (`backend/src/stores/stores.service.ts`) — Sistema de Estoque (S.E.) com telemetria de consulta e reserva.
  - `OperadoraCartaoService` (`backend/src/payments/operadora-cartao.service.ts`) — Gateway financeiro.

---

## 7. Como Executar o Projeto

### Pré-requisitos
- **Node.js 18+** e **npm** instalados.
- Projeto **Supabase** configurado (`backend/supabase_schema.sql`).

### Passo 1: Configurar Variáveis de Ambiente e Dependências

```bash
cp .env.example .env
# Preencha SUPABASE_URL, SUPABASE_ANON_KEY e SECRET_TOKEN_KEY no arquivo .env
npm install
```

### Passo 2: Iniciar o Backend NestJS

```bash
npm run start:dev
```

O servidor NestJS iniciará em `http://127.0.0.1:5000` (ou `https://` caso `HTTPS_KEY_PATH` e `HTTPS_CERT_PATH` estejam definidos).

### Passo 3: Acessar a Aplicação

Abra diretamente no navegador:
- `http://127.0.0.1:5000` (ou a URL HTTPS do ambiente de demo na Vercel).

---

### Testes de contrato da API (S2-07)

Os testes em `tests/contract/` falam com a API só por HTTP (Vitest + `fetch`), então rodam contra qualquer ambiente:

```bash
# API local (padrão http://127.0.0.1:5000)
npm test

# Outro ambiente
API_URL=https://study-mega-loja-online-site.vercel.app npm test
```

Por padrão rodam só as consultas e as recusas, que não gravam nada. Duas variáveis liberam o resto:

- `CONTRACT_WRITE=1`: fluxos que criam pedidos (compra, separação, retirada, expiração). Deixam pedidos de teste no banco e consomem 1 unidade de estoque.
- `CONTRACT_DESTRUCTIVE=1` (junto com a anterior): teste de ruptura (UC008), que **zera o estoque** do produto na filial usada. Só em banco descartável.

## 8. Roteiro da Demo (Apresentação da Sprint)

Este roteiro guia a demonstração completa da arquitetura **NestJS + TypeScript + Supabase**:

1. **Segurança (HTTPS, Segredos Fora do Código) e Telemetria RNF001 (Sprint 3):**
   - Acesse `/api/health` e `/api/metrics/rnf001` no ambiente de demo (HTTPS).
   - Mostre o status `secrets_externalized: true` (nenhum segredo no código) e os cabeçalhos `Strict-Transport-Security` e `X-Response-Time-Ms`.

2. **Catálogo e Estoque Dinâmicos via Supabase (RF001 / RF002 / UC002):**
   - Abra a aplicação na visão **Cliente** e o painel **Table Editor** do Supabase (`public.products` e `public.inventory`).
   - Mostre que os produtos, preços, SKUs, códigos de barras e URLs de imagem (`image_url`) vêm em tempo real do banco PostgreSQL no Supabase via `GET /api/products`.
   - Alterne a filial no topo (*Canoas Centro*, *Canoas Shopping*, *São Leopoldo Bourbon*) para demonstrar a consulta de estoque por filial em tempo real (`GET /api/stores?product_id=...`).

3. **UC003 - Finalizar Compra e Medição de Reserva de Estoque (RNF001 $\le$ 60s):**
   - Selecione um produto com estoque na filial ativa e clique em **Retirar na Loja**.
   - **Teste de Recusa de Cartão (Fluxo 5.1.5.2):** Marque *Simular recusa da Operadora de Cartão* e tente finalizar — a API NestJS retornará erro HTTP `402`.
   - **Compra Aprovada com Terceiro Autorizado (Fluxo 5.3.5.1):** Desmarque a simulação de recusa, habilite *Retirada por Terceiro Autorizado*, informe nome e CPF do terceiro e clique em **Finalizar Compra**.
   - Consulte `GET /api/metrics/rnf001` para comprovar que tanto `consulta_estoque` quanto `reserva_estoque` responderam muito abaixo do limite de `60000 ms` (60 s), com `compliance_rate_percent: 100`.

4. **UC005 - Separação de Pedido no Balcão (Perfil Operador):**
   - Alterne para a visão **Balcão / Operador**, selecione o pedido em *UC005 Separação de Pedidos*, clique em **Bipar** para validar o SKU/código de barras e clique em **Concluir Embalagem**.
   - Retorne à visão **Cliente**: o status mudou para `Pronto para Retirada` e o **QR Code assinado via HMAC (RNF003)** foi liberado.

5. **UC007 & UC008 - Validação Presencial da Retirada e Ruptura de Estoque:**
   - Em *UC007 Validação Presencial*, localize o pedido pelo Voucher ou CPF, marque a conferência do documento físico e confirme a entrega (`entregue_cliente`).
   - Para demonstrar o ponto de extensão *UC008*, crie um novo pedido e clique em **Registrar Indisponibilidade (UC008)** na esteira de separação: o pedido muda para `cancelado_ruptura`, aciona estorno e zera o estoque da filial no Supabase.
