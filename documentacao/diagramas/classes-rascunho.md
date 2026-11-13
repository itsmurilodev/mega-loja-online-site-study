# Rascunho do diagrama de classes (S2-02)

Rascunho gerado a partir do código em 04/11/2026 (`backend/services.py`, `backend/database.py`, `backend/api.py`, `backend/config.py`).
**É um ponto de partida para a Júlia revisar e redesenhar no Draw.io**, não a versão final do S2-02.
Os nomes de atributos são os reais (colunas do banco). Os nomes de classe em português seguem o diagrama de sequência da Sprint 1.

## Diagrama (Mermaid)

Para ver: colar em <https://mermaid.live>, ou no Draw.io usar Organizar > Inserir > Avançado > Mermaid (se o menu for outro, exportar o SVG/PNG do mermaid.live e importar).

```mermaid
classDiagram
direction LR

%% ---------- Boundary (fronteira) ----------
class InterfaceCheckout {
  <<boundary>>
  front.html (cliente, UC003)
}
class PainelBalcao {
  <<boundary>>
  front.html (operador, UC005 UC007 UC008)
}
class ApiHandler {
  <<boundary>>
  +do_GET()
  +do_POST()
  +do_PATCH()
  +do_OPTIONS()
}

%% ---------- Control (controle) ----------
class ControladorPedido {
  <<control>>
  +create_order(payload) UC003
  +separate_order(order_id, payload) UC005
  +register_ruptura(order_id, payload) UC008
  +validate_pickup(payload) UC007
  +expire_abandoned_order(order_id)
  +update_order_status(order_id, payload)
  +list_orders(store_id, status)
  +list_stores(city, product_id)
  +list_products(store_id)
  +list_notifications(order_id)
}

%% ---------- Sistemas externos (simulados no protótipo) ----------
class SistemaEstoqueService {
  <<sistema externo simulado>>
  +consultar_disponibilidade(conn, store_id, product_id, quantity)
  +reservar_estoque(conn, store_id, product_id, quantity)
  +devolver_estoque(conn, store_id, product_id, quantity)
  +registrar_ruptura_fisica(conn, store_id, product_id)
}
class OperadoraCartaoService {
  <<sistema externo simulado>>
  +processar_pagamento(cartao_numero, simular_recusa)
}
class ApiError {
  <<exception>>
  +int status
  +str message
}

%% ---------- Entity (entidades = tabelas) ----------
class Loja {
  <<entity>>
  +int id
  +str name
  +str city
  +str zip_code
  +str address
  +int capacity
  +int active
}
class Produto {
  <<entity>>
  +int id
  +str name
  +str category
  +float price
  +str sku
  +str barcode
}
class Estoque {
  <<entity>>
  +int store_id
  +int product_id
  +int quantity
}
class Pedido {
  <<entity>>
  +int id
  +str customer_name
  +str customer_cpf
  +str delivery_method
  +int store_id
  +int product_id
  +int quantity
  +str status
  +str pickup_code
  +str card_number_masked
  +str payment_status
  +str third_party_name
  +str third_party_cpf
  +str discount_coupon  (legado, nunca gravado)
  +int refund_requested
  +str cancellation_reason
  +str created_at
  +str updated_at
}
class Notificacao {
  <<entity>>
  +int id
  +int order_id
  +str message
  +str created_at
}

%% ---------- Valores fixos (config.py) ----------
class StatusPedido {
  <<enumeration>>
  aguardando_separacao
  pronto_retirada
  entregue_cliente
  cancelado_ruptura
  cancelado_expirado
}
class MetodoEntrega {
  <<enumeration>>
  retirar_na_loja
  entrega_padrao
}

%% ---------- PLANEJADO para a Sprint 3 (nao existe no codigo) ----------
class Usuario {
  <<entity, planejado S3>>
  +id
  +email
  +papel
}
class Empresa {
  <<entity, planejado S3>>
  +id
  +nome
}
class Papel {
  <<enumeration, planejado S3>>
  cliente
  operador
  empresa
}

%% ---------- Relacionamentos ----------
InterfaceCheckout ..> ApiHandler : HTTP JSON
PainelBalcao ..> ApiHandler : HTTP JSON
ApiHandler --> ControladorPedido : delega
ApiHandler ..> ApiError : captura

ControladorPedido ..> SistemaEstoqueService : consulta e reserva
ControladorPedido ..> OperadoraCartaoService : cobra
ControladorPedido ..> ApiError : lanca
ControladorPedido ..> Pedido : cria e atualiza
ControladorPedido ..> Notificacao : registra

Loja "1" --> "0..*" Estoque
Produto "1" --> "0..*" Estoque
Loja "0..1" --> "0..*" Pedido : retirada em
Produto "1" --> "0..*" Pedido
Pedido "1" --> "0..*" Notificacao
Pedido ..> StatusPedido
Pedido ..> MetodoEntrega

Empresa "1" --> "0..*" Produto : cadastra
Usuario "1" --> "0..*" Pedido : realiza
Usuario ..> Papel

```

## O que bate e o que não bate com o código

| # | Observação | Decisão sugerida |
|---|---|---|
| 1 | `ControladorPedido` **não existe como classe**. O papel de controle é feito por funções de módulo em `services.py`. O nome só aparece em docstrings e no README | Manter no diagrama como controle conceitual, com nota "realizado por funções de services.py". Refatorar para classe só se o PO quiser |
| 2 | `InterfaceCheckout` e `PainelBalcao` são **conceituais**: ambos vivem em `front.html`, sem classes JavaScript com esses nomes | Manter como fronteiras lógicas |
| 3 | Só 4 classes reais: `ApiHandler`, `ApiError`, `OperadoraCartaoService`, `SistemaEstoqueService` (esta e a de cartão só com métodos estáticos) | Documentado acima |
| 4 | `Estoque` é tabela de associação Loja x Produto com `quantity` (chave composta) | Pode virar classe de associação no Draw.io |
| 5 | `Pedido` guarda **um produto e uma quantidade** (`product_id`, `quantity`). Não há item de pedido nem carrinho no backend | Limitação do modelo, registrar no documento |
| 6 | `discount_coupon` é resíduo do cupom removido no commit `4db6e39`: está na tabela e nas consultas, mas nenhum código grava nele | Marcar como legado no diagrama e remover do esquema numa limpeza (ideal antes de migrar para o Supabase, S3-06) |
| 7 | `StatusPedido`: `config.py` também aceita aliases legados (`aguardando_preparacao`, `retirado`, `cancelado`) | Diagrama mostra só os 5 oficiais |
| 8 | Sistema de Estoque e Operadora de Cartão são **simulados** (SQLite local e regra "cartão terminado em 0000 recusa") | Nota no diagrama: atores externos previstos, não integrados |
| 9 | Relacionamentos Pedido→Produto e Pedido→Loja existem como chave estrangeira. `store_id` é opcional (entrega padrão) | Cardinalidade `0..1` já marcada |
| 10 | Usuário, Empresa e Papel **não existem no código**. Entraram só porque o S3-07 e o S3-08 os exigem | Desenhar tracejado ou em cinza e legendar "planejado, Sprint 3" |

## Antes de entregar (checklist do S2-02)

- [ ] Júlia confere atributos e métodos contra o código (este rascunho é de 04/11; se o S2-06, S2-08 ou o S2-12 mudarem o backend, atualizar)
- [ ] Redesenhar no Draw.io e salvar `.drawio` e `.png` nesta pasta
- [ ] João revisa
