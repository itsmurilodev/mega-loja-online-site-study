# Backend do Sistema Central de Click & Collect • Trabalho G2

Backend desenvolvido para a disciplina de **Laboratório de Engenharia de Software** da Universidade LaSalle, estruturado em torno da Sprint do **Trabalho G2**.

## 1. Integrantes e Papéis (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Casos de Uso Contemplados

- **UC003 - Finalizar Compra**:
  - Consulta obrigatória de estoque em tempo real na filial (UC002).
  - Aplicação automática de frete R$ 0,00.
  - Processamento financeiro com a Operadora de Cartão (RF003).
  - Suporte a autorização de terceiro para retirada (Fluxo 5.3.5.1).
  - Simulação de recusa de transação (Fluxo 5.1.5.2).
  - Status inicial: `aguardando_separacao`.
- **UC005 - Separar Pedido**:
  - Painel de separação por filial com ordenação de pedidos.
  - Leitura ótica de código de barras ou digitação manual de SKU (Fluxo 5.2.5.2).
  - Status atualizado para `pronto_retirada` e geração do voucher/QR Code seguro (UC006 / RNF003).
- **UC008 - Registrar Ruptura de Estoque** (*Ponto de Extensão de UC005*):
  - Acionado em caso de falta de item físico na prateleira (Fluxo 5.2.5.1).
  - Status atualizado para `cancelado_ruptura`.
  - Disparo de solicitação de estorno à operadora financeira e ajuste de estoque.
- **UC007 - Validar Retirada**:
  - Validação no balcão por leitura de QR Code ou busca manual por CPF/Pedido (Fluxo 5.3.5.2).
  - Conferência de documento físico (titular ou terceiro autorizado cadastrado).
  - Status final: `entregue_cliente`.

---

## 3. Tecnologias

- **Python 3** (servidor HTTP nativo, sem necessidade de `pip install`);
- **SQLite 3** com integridade referencial ativa (`PRAGMA foreign_keys = ON`);
- **Arquitetura BCE** (*Boundary, Control, Entity*) aplicada na camada de serviços;
- **API REST** com respostas padronizadas em JSON e suporte a CORS.

---

## 4. Como Executar

Na raiz do projeto:

```bash
python3 backend/app.py
```

A API iniciará em:

```text
http://127.0.0.1:5000
```

---

## 5. Endpoints da API

| Método | Endpoint | Caso de Uso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | - | Diagnóstico de integridade da API |
| `GET` | `/api/stores` | RF001 | Lista filiais com estoque por produto |
| `GET` | `/api/products` | RF002 | Lista produtos do catálogo com SKU e código de barras |
| `GET` | `/api/orders` | RF005 | Lista pedidos (filtros por loja e status) |
| `POST` | `/api/orders` | **UC003** | Finalizar compra, reservar estoque e processar cartão |
| `POST` | `/api/orders/{id}/separate` | **UC005** | Registrar separação com leitura de SKU e liberar QR Code |
| `POST` | `/api/orders/{id}/rupture` | **UC008** | Registrar ruptura de estoque e solicitar estorno |
| `POST` | `/api/orders/validate-pickup` | **UC007** | Validar retirada presencial e registrar entrega |
| `POST` | `/api/orders/{id}/expire` | Abandono | Cancelar por não-comparecimento (7 dias) e devolver estoque |
