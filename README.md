# MegaLoja Online • Sistema Central de Click & Collect

Projeto desenvolvido para a disciplina de **Laboratório de Engenharia de Software** da **Universidade LaSalle (Unilasalle)** — **Trabalho G2**.

O objetivo do sistema é unificar o ambiente de compras digitais ao estoque das lojas físicas, permitindo que o cliente compre pelo site e retire o produto diretamente em uma filial de sua preferência com frete grátis, validação segura por QR Code e integração em tempo real com estoque e operadora financeira.

---

## 1. Integrantes e Papéis no Projeto (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Atores do Sistema

- **Ator 1: Cliente** — Usuário final que realiza a compra, seleciona a filial para retirada, recebe o QR Code e busca o produto na loja física.
- **Ator 2: Operador da Loja** — Funcionário responsável por receber o pedido no painel local, separar e embalar o produto no estoque físico e validar a entrega ao cliente.
- **Ator 3: Sistema de Estoque (S.E.)** — Ator externo/suporte que monitora e fornece a disponibilidade de itens por loja em tempo real e registra a reserva/baixa física.
- **Ator 4: Operadora de Cartão** — Serviço externo responsável por receber os dados do cartão do cliente, processar a transação financeira em tempo real e retornar o status da cobrança (aprovado ou recusado).

---

## 3. Casos de Uso Detalhados (Sprint G2)

### UC003 - Finalizar Compra
- **Ator Principal:** Cliente
- **Relação de Inclusão (`<<include>>`):** `UC002 - Consultar Disponibilidade` obrigatória no S.E.
- **Regras:** Aplica frete R$ 0,00, processa pagamento na Operadora de Cartão (RF003), reserva item no estoque e gera pedido com status inicial `Aguardando Separação`.
- **Fluxos Alternativos:**
  - `5.1.5.1 Item indisponível na loja selecionada`: Alerta o cliente e sugere outra filial ou entrega domiciliar.
  - `5.1.5.2 Pagamento recusado`: Informa falha na transação e solicita nova forma de pagamento.
  - `5.3.5.1 Retirada por terceiro autorizado`: Permite informar nome e CPF de quem retirará a encomenda.

### UC005 - Separar Pedido
- **Ator Principal:** Operador da Loja (Perfil Retaguarda)
- **Regras:** Painel local com ordenação de pedidos pendentes, conferência de código de barras ou digitação manual de SKU (Fluxo 5.2.5.2) e embalagem.
- **Conclusão:** Status atualizado para `Pronto para Retirada`, geração automática do QR Code criptografado (UC006 / RNF003) e notificação ao cliente.
- **Ponto de Extensão (`<<extend>>`):** `UC008 - Registrar Ruptura (Falta de Item)`.

### UC008 - Registrar Ruptura (Falta de Item)
- **Ator Principal:** Operador da Loja
- **Regra:** Disparado quando o item físico não se encontra na prateleira (Fluxo 5.2.5.1). O pedido é cancelado (`cancelado_ruptura`), a solicitação de estorno é emitida à operadora de cartão e o estoque da filial é corrigido para zero.

### UC007 - Validar Retirada
- **Ator Principal:** Operador da Loja / Atendente de Balcão
- **Regras:** Escaneamento do QR Code com conferência de documento físico com foto (titular ou terceiro previamente cadastrado).
- **Fluxo Alternativo 5.3.5.2 (QR Code ilegível/expirado):** Busca manual de contingência por CPF e número do pedido.
- **Conclusão:** Status final `Entregue ao Cliente` e emissão automática de **Cupom de Desconto de 5%** para compras na loja física (Passo 8).

---

## 4. Requisitos do Sistema

### Requisitos Funcionais (RFs)
- **RF001:** Seleção de Filial para Retirada durante o checkout.
- **RF002:** Consulta de Disponibilidade de Estoque em Tempo Real (UC002).
- **RF003:** Processamento de Pagamento Online com frete gratuito.
- **RF004:** Notificação e Envio de QR Code seguro após separação.
- **RF005:** Painel de Separação de Pedidos com leitura de código de barras/SKU.
- **RF006:** Registro de Ruptura de Estoque com cancelamento e estorno (UC008).
- **RF007:** Validação Presencial da Retirada (QR Code e baixa definitiva).

### Requisitos Não Funcionais (RNFs)
- **RNF001:** Tempo de Resposta e Sincronização $\le$ 60 segundos.
- **RNF002:** Segurança e Criptografia (HTTPS/SSL e dados sensíveis protegidos).
- **RNF003:** Autenticidade do Voucher (QR Code assinado/criptografado contra fraudes).
- **RNF004:** Operação Tolerante a Falhas / Modo Offline (contingência e cache local).
- **RNF005:** Acessibilidade do Painel (responsivo para coletores portáteis e terminais web).

---

## 5. Arquitetura BCE (Boundary, Control, Entity)

Conforme modelado no Diagrama de Sequência do Trabalho G2:
- **Boundary (Fronteira):** `InterfaceCheckout` e `PainelBalcao` (`front.html`).
- **Control (Controle):** `ControladorPedido` (`backend/services.py`).
- **Entity / Sistemas Externos:** `SistemaEstoqueService` (S.E.) e `OperadoraCartaoService` (`backend/services.py`).

---

## 6. Como Executar o Projeto

### Passo 1: Iniciar o Backend

```bash
python3 backend/app.py
```
O servidor iniciará em `http://127.0.0.1:5000`.

### Passo 2: Acessar a Aplicação

Abra o arquivo `front.html` diretamente no navegador ou via servidor local (ex: Live Server ou `python3 -m http.server 3000`).

### Passo 3: Demonstrar os Fluxos da Sprint

1. **Visão Cliente:**
   - Escolha a filial (ex: Canoas Centro).
   - Selecione um produto com estoque e clique em *Retirar na Loja*.
   - No checkout, preencha os dados do titular e opcionalmente marque *Retirada por Terceiro Autorizado* (Fluxo 5.3.5.1).
   - É possível testar a simulação de recusa de cartão (Fluxo 5.1.5.2) marcando a opção indicada.
   - Conclua a compra: o comprovante será exibido e o status ficará como `Aguardando Separação` com QR Code bloqueado.
2. **Visão Balcão / Operador:**
   - No topo, alterne para *Balcão / Operador*.
   - Em *UC005 Separação de Pedidos*, selecione o pedido, clique em *Bipar* para ler o SKU/código de barras e clique em *Concluir Embalagem*.
   - Volte à visão do cliente: o QR Code estará liberado com voucher único assinado!
   - Para demonstrar o ponto de extensão *UC008*, clique em *Registrar Indisponibilidade* na esteira de separação.
   - Em *UC007 Validação Presencial*, escaneie o voucher ou faça busca manual por CPF, confira o documento do recebedor e confirme a entrega: o sistema registra a baixa `Entregue ao Cliente` e entrega o cupom de 5% de desconto!
