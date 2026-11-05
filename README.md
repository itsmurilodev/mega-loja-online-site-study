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
- **Deploy Serverless:** Configurado para **Vercel** (`vercel.json` + `api/index.ts`).

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

## 5. Requisitos do Sistema

### Requisitos Funcionais (RFs)
- **RF001:** Seleção de Filial para Retirada durante o checkout (`GET /api/stores`).
- **RF002:** Consulta de Disponibilidade de Estoque em Tempo Real (`GET /api/products` e `GET /api/stores?product_id=...`).
- **RF003:** Processamento de Pagamento Online com frete gratuito (`OperadoraCartaoService`).
- **RF004:** Notificação e Envio de QR Code seguro após separação (`notifications`).
- **RF005:** Painel de Separação de Pedidos com leitura de código de barras/SKU (`POST /api/orders/:id/separate`).
- **RF006:** Registro de Ruptura de Estoque com cancelamento e estorno (`POST /api/orders/:id/rupture`).
- **RF007:** Validação Presencial da Retirada (`POST /api/orders/validate-pickup`).

### Requisitos Não Funcionais (RNFs)
- **RNF001:** Tempo de Resposta e Sincronização $\le$ 60 segundos com banco PostgreSQL em nuvem (Supabase).
- **RNF002:** Segurança e Criptografia (HTTPS/SSL, RLS ativo no Supabase e mascaramento de cartão `•••• •••• •••• 1234`).
- **RNF003:** Autenticidade do Voucher (QR Code assinado via HMAC-SHA256 contra fraudes).
- **RNF004:** Operação Tolerante a Falhas (tratamento padronizado via `AllExceptionsFilter`).
- **RNF005:** Acessibilidade do Painel (responsivo para coletores portáteis e terminais web).

---

## 6. Arquitetura BCE (Boundary, Control, Entity) no NestJS

Conforme modelado no Diagrama de Sequência do Trabalho G2:
- **Boundary (Fronteira):** `InterfaceCheckout` e `PainelBalcao` (`front.html`) + Controllers HTTP do NestJS (`StoresController`, `ProductsController`, `OrdersController`).
- **Control (Controle):** `OrdersService` (`backend/src/orders/orders.service.ts`), orquestrando os fluxos de negócio.
- **Entity / Sistemas Externos:**
  - `SupabaseService` (`backend/src/supabase/supabase.service.ts`) — Persistência PostgreSQL em nuvem.
  - `StoresService` (`backend/src/stores/stores.service.ts`) — Sistema de Estoque (S.E.).
  - `OperadoraCartaoService` (`backend/src/payments/operadora-cartao.service.ts`) — Gateway financeiro.

---

## 7. Como Executar o Projeto

### Pré-requisitos
- **Node.js 18+** e **npm** instalados.
- Projeto **Supabase** configurado (as tabelas e produtos já estão criados no projeto `megaloja-online` e o script DDL encontra-se em `backend/supabase_schema.sql`).

### Passo 1: Configurar Variáveis de Ambiente e Dependências

```bash
cp .env.example .env
npm install
```

### Passo 2: Iniciar o Backend NestJS

```bash
npm run start:dev
```

O servidor NestJS iniciará em `http://127.0.0.1:5000`.

### Passo 3: Acessar a Aplicação

Abra diretamente no navegador:
- `http://127.0.0.1:5000` (o NestJS serve o `front.html` automaticamente na raiz `/`), ou
- Abra o arquivo `front.html` via Live Server / navegador.

---

## 8. Roteiro da Demo (Apresentação da Sprint)

Este roteiro guia a demonstração completa da arquitetura **NestJS + TypeScript + Supabase**:

1. **Catálogo e Estoque Dinâmicos via Supabase (RF001 / RF002 / UC002):**
   - Abra a aplicação na visão **Cliente** e o painel **Table Editor** do Supabase (`public.products` e `public.inventory`).
   - Mostre que os produtos, preços, SKUs, códigos de barras e URLs de imagem (`image_url`) vêm em tempo real do banco PostgreSQL no Supabase via `GET /api/products` (sem dados hardcoded no código).
   - Alterne a filial no topo (*Canoas Centro*, *Canoas Shopping*, *São Leopoldo Bourbon*) para demonstrar a atualização de estoque por filial em tempo real (`GET /api/stores?product_id=...`).

2. **UC003 - Finalizar Compra e Fluxos Alternativos:**
   - Selecione um produto com estoque na filial ativa e clique em **Retirar na Loja**.
   - **Teste de Recusa de Cartão (Fluxo 5.1.5.2):** Marque a opção *Simular recusa da Operadora de Cartão* e tente finalizar — a API NestJS (`OperadoraCartaoService`) retornará erro HTTP `402` impedindo a criação do pedido.
   - **Compra Aprovada com Terceiro Autorizado (Fluxo 5.3.5.1):** Desmarque a simulação de recusa, habilite *Retirada por Terceiro Autorizado*, informe nome e CPF do terceiro e clique em **Finalizar Compra**.
   - Mostre o comprovante gerado com status `Aguardando Separação` (QR Code bloqueado) e verifique no Supabase que o pedido foi gravado em `public.orders` (com cartão mascarado) e o saldo em `public.inventory` foi decrementado automaticamente.

3. **UC005 - Separação de Pedido no Balcão (Perfil Operador):**
   - No cabeçalho, alterne para a visão **Balcão / Operador**.
   - Em *UC005 Separação de Pedidos*, selecione o pedido recém-criado.
   - Digite um SKU incorreto para demonstrar a trava de conferência (`400 Bad Request`).
   - Clique em **Bipar** (ou informe o SKU/código de barras correto do produto) e clique em **Concluir Embalagem**.
   - Retorne à visão **Cliente**: o status mudou para `Pronto para Retirada` e o **QR Code assinado via HMAC (RNF003)** foi liberado!

4. **UC007 - Validação Presencial da Retirada:**
   - Volte para **Balcão / Operador** na seção *UC007 Validação Presencial*.
   - Localize o pedido pelo código do Voucher (`HV-...`) ou pela busca manual de contingência por CPF (Fluxo 5.3.5.2).
   - Observe o alerta destacando os dados do **Terceiro Autorizado** cadastrado no checkout.
   - Tente confirmar sem marcar o checkbox de documento para demonstrar a trava de segurança obrigatória.
   - Marque *Documento físico oficial conferido* e clique em **Validar Retirada & Confirmar Entrega (UC007)**: o pedido é atualizado no Supabase para `entregue_cliente`, encerrando o ciclo.

5. **UC008 - Ponto de Extensão: Ruptura de Estoque e Regra de Abandono:**
   - Crie um novo pedido na visão **Cliente** e vá para **Balcão / Operador**.
   - Na esteira de separação, clique em **Registrar Indisponibilidade (UC008)** e informe o motivo: o status muda para `cancelado_ruptura`, o estorno financeiro (`refund_requested = 1`) é registrado em `public.orders` e o estoque do item na filial (`public.inventory`) é zerado no Supabase para impedir novas vendas indevidas.
