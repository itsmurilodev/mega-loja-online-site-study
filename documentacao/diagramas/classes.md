# Diagrama de classes (S2-02)

> Gerado a partir do código da `main` em 12/11/2026 (backend NestJS + Supabase). É a versão em Mermaid, que o GitHub desenha sozinho; a imagem está em `classes.png`. O cartão pede também o arquivo `.drawio`: para isso, no Draw.io use Organizar > Inserir > Avançado > Mermaid e cole o bloco abaixo. Falta a revisão da Júlia e do João.

![Diagrama de classes](classes.png)

```mermaid
classDiagram
direction LR

class InterfaceCheckout {
  <<boundary>>
  frontend/front.html + js/app.js
  vitrine, checkout e comprovante (UC003)
}
class PainelBalcao {
  <<boundary>>
  frontend/front.html + js/app.js
  separacao, ruptura e retirada (UC005 UC007 UC008)
}
class OrdersController {
  <<boundary>>
  +listOrders(storeId, status)
  +createOrder(payload)
  +getOrder(id)
  +getNotifications(id)
  +separateOrder(id, payload)
  +registerRuptura(id, payload)
  +validatePickup(payload)
  +expireOrder(id)
  +updateStatus(id, payload)
}
class StoresController {
  <<boundary>>
  +getStores(city, productId)
}
class ProductsController {
  <<boundary>>
  +getProducts(storeId)
}
class AppController {
  <<boundary>>
  +getHealth()
  +getApiIndex()
  +getRnf001Metrics()
}
class AllExceptionsFilter {
  <<boundary>>
  +catch(exception, host)
}

class OrdersService {
  <<control>>
  ControladorPedido
  +createOrder(payload) UC003
  +separateOrder(orderId, payload) UC005
  +registerRuptura(orderId, payload) UC008
  +validatePickup(payload) UC007
  +expireAbandonedOrder(orderId)
  +updateOrderStatus(orderId, payload)
  +listOrders(storeId, status)
  +findOrder(orderId)
  +listNotifications(orderId)
  -generatePickupCode(orderId)
  -createNotification(orderId, message)
}
class StoresService {
  <<control>>
  SistemaEstoque (simulado)
  +listStores(city, productId)
  +findActiveStoreById(storeId)
  +consultarDisponibilidade(storeId, productId, quantity) UC002
  +reservarEstoque(storeId, productId, quantity)
  +devolverEstoque(storeId, productId, quantity)
  +registrarRupturaFisica(storeId, productId)
}
class ProductsService {
  <<control>>
  +listProducts(storeId)
  +findProductById(productId)
}
class OperadoraCartaoService {
  <<sistema externo simulado>>
  +processarPagamento(cartaoNumero, simularRecusa)
}
class RnfMetricsService {
  <<control>>
  +record(operation, action, durationMs, metadata)
}
class SupabaseService {
  <<infraestrutura>>
  +client SupabaseClient
}

class Loja {
  <<entity>>
  tabela stores
  +id
  +name
  +city
  +zip_code
  +address
  +capacity
  +active
}
class Produto {
  <<entity>>
  tabela products
  +id
  +name
  +category
  +price
  +image_url
  +sku
  +barcode
}
class Estoque {
  <<entity>>
  tabela inventory
  +store_id
  +product_id
  +quantity
}
class Pedido {
  <<entity>>
  tabela orders
  +id
  +customer_name
  +customer_cpf
  +delivery_method
  +store_id
  +product_id
  +quantity
  +status
  +pickup_code
  +card_number_masked
  +payment_status
  +third_party_name
  +third_party_cpf
  +refund_requested
  +cancellation_reason
  +created_at
  +updated_at
}
class Notificacao {
  <<entity>>
  tabela notifications
  +id
  +order_id
  +message
  +created_at
}
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

class Usuario {
  <<planejado Sprint 3>>
  +id
  +nome
  +email
  +papel
}
class Empresa {
  <<planejado Sprint 3>>
  +id
  +nome
}
class Papel {
  <<planejado Sprint 3>>
  cliente
  operador
  empresa
}

InterfaceCheckout ..> OrdersController : HTTP JSON
InterfaceCheckout ..> StoresController : HTTP JSON
InterfaceCheckout ..> ProductsController : HTTP JSON
PainelBalcao ..> OrdersController : HTTP JSON
OrdersController --> OrdersService : delega
StoresController --> StoresService : delega
ProductsController --> ProductsService : delega
OrdersController ..> AllExceptionsFilter : erros viram error JSON

OrdersService --> StoresService : consulta e reserva
OrdersService --> ProductsService : busca produto
OrdersService --> OperadoraCartaoService : cobra
OrdersService --> SupabaseService
StoresService --> SupabaseService
StoresService --> RnfMetricsService : mede RNF001
ProductsService --> SupabaseService
OrdersService ..> Pedido : cria e atualiza
OrdersService ..> Notificacao : registra

Loja "1" --> "0..*" Estoque
Produto "1" --> "0..*" Estoque
Loja "0..1" --> "0..*" Pedido : retirada em
Produto "1" --> "0..*" Pedido
Pedido "1" --> "0..*" Notificacao
Pedido ..> StatusPedido
Pedido ..> MetodoEntrega

Empresa "1" ..> "0..*" Produto : cadastra
Usuario "1" ..> "0..*" Pedido : realiza
Usuario ..> Papel
```

## Como ler

- **Fronteira (boundary):** as telas do front (`InterfaceCheckout`, `PainelBalcao`) e os controladores HTTP do NestJS.
- **Controle (control):** os serviços. `OrdersService` é o `ControladorPedido` dos diagramas de sequência.
- **Entidade (entity):** as tabelas do Supabase. Não existem classes de entidade no código; os nomes em português são os do modelo e o nome da tabela está em cada caixa.
- **Planejado Sprint 3:** `Usuario`, `Empresa` e `Papel` ainda não existem no código (S3-07 e S3-08).

## O que bate e o que não bate com o código

| # | Observação |
|---|---|
| 1 | `ControladorPedido` agora **é uma classe**: `OrdersService` (`backend/src/orders/orders.service.ts`). No rascunho de 04/11, em Python, era só um conjunto de funções. |
| 2 | `InterfaceCheckout` e `PainelBalcao` são fronteiras lógicas: as duas vivem em `frontend/front.html` e `frontend/js/app.js`, sem classes com esses nomes. |
| 3 | Sistema de Estoque e Operadora de Cartão são **simulados**: o estoque é a tabela `inventory` do próprio banco e o cartão é recusado por regra local (final 0000 ou opção de teste). |
| 4 | `Pedido` guarda **um produto e uma quantidade**. Não há item de pedido nem carrinho. |
| 5 | `Estoque` é a associação Loja x Produto com `quantity` (chave composta). |
| 6 | `StatusPedido` mostra os 5 estados oficiais; o código ainda aceita 3 apelidos antigos (`aguardando_preparacao`, `retirado`, `cancelado`). |
| 7 | `discount_coupon` saiu do diagrama: a coluna não existe no banco e está sendo removida do código no PR #7. |
| 8 | Os endpoints do operador ainda não exigem login (S3-14). |

O rascunho anterior, feito sobre o backend Python, continua em `classes-rascunho.md` como histórico.
