# Backend do Sistema Central de Click & Collect • Trabalho G2

Backend desenvolvido para a disciplina de **Laboratório de Engenharia de Software** da Universidade LaSalle, estruturado em torno da Sprint do **Trabalho G2**.

## 1. Integrantes e Papéis (Metodologia SCRUM)

- **Murilo Alves** — *Scrum Master*
- **João Vitor G. Valli** — *Product Owner (PO)*
- **Leonardo Quadros** — *Desenvolvedor*
- **Guilherme Reis** — *Desenvolvedor*
- **Júlia Normando** — *Analista de Requisitos / Testes*

---

## 2. Casos de Uso e Limites do Protótipo

Os casos abaixo representam fluxos demonstrados parcialmente no protótipo local. Não há integração com serviços externos de estoque, pagamento, e-mail ou leitura óptica.

- **UC003 - Finalizar Compra**:
  - Consulta e reserva de estoque na base SQLite local (UC002); não há sincronização em tempo real com sistema externo.
  - Aplicação automática de frete R$ 0,00.
  - Simulação local de aprovação ou recusa financeira; nenhuma operadora é chamada.
  - Suporte a autorização de terceiro para retirada (Fluxo 5.3.5.1).
  - Simulação de recusa de transação (Fluxo 5.1.5.2).
  - Status inicial: `aguardando_separacao`.
- **UC005 - Separar Pedido**:
  - Painel de separação por filial e conferência manual do SKU/código de barras; o botão “Bipar” apenas preenche um valor de teste.
  - Status atualizado para `pronto_retirada`, voucher único assinado com HMAC e notificação registrada no SQLite (UC006 / RNF003); não há envio de e-mail.
- **UC008 - Registrar Ruptura de Estoque** (*Ponto de Extensão de UC005*):
  - Acionado em caso de falta de item físico na prateleira (Fluxo 5.2.5.1).
  - Status atualizado para `cancelado_ruptura`.
  - Registro local de `refund_requested` e ajuste do estoque local; nenhum estorno real é enviado à operadora.
- **UC007 - Validar Retirada**:
  - Validação no balcão por código de voucher informado manualmente ou busca por CPF/pedido (Fluxo 5.3.5.2); não há leitor de QR/câmera.
  - Registro da confirmação do operador sobre a conferência do documento (a conferência física não pode ser comprovada pelo sistema).
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
| `POST` | `/api/orders/{id}/separate` | **UC005** | Conferir SKU/código de barras informado manualmente e liberar voucher |
| `POST` | `/api/orders/{id}/rupture` | **UC008** | Registrar ruptura e solicitação local de estorno |
| `POST` | `/api/orders/validate-pickup` | **UC007** | Validar retirada presencial e registrar entrega |
| `POST` | `/api/orders/{id}/expire` | Abandono | Cancelar por não-comparecimento (7 dias) e devolver estoque |

O endpoint de abandono simula o decurso de sete dias e registra a solicitação de estorno no protótipo; não efetua estorno financeiro.
