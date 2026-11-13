# Diagramas de sequência de UC005 e UC007 (S2-04)

> Gerado a partir do código da `main` em 12/11/2026 (backend NestJS + Supabase). É a versão em Mermaid, que o GitHub desenha sozinho; a imagem está em `sequencia-uc005.png` e `sequencia-uc007.png`. O cartão pede também o arquivo `.drawio`: para isso, no Draw.io use Organizar > Inserir > Avançado > Mermaid e cole o bloco abaixo. Falta a revisão da Júlia e do João.

Seguem o padrão BCE do diagrama do UC003 entregue na Sprint 1.

## UC005 Separar Pedido (com a extensão UC008 Registrar Ruptura)

![Sequência UC005](sequencia-uc005.png)

```mermaid
sequenceDiagram
  autonumber
  actor Operador as Operador da Loja
  participant Painel as PainelBalcao (boundary)
  participant Ctrl as ControladorPedido (control) OrdersService
  participant Pedido as Pedido (entity) tabela orders
  participant Notif as Notificacao (entity)
  participant SE as SistemaEstoque StoresService (simulado)

  Operador->>Painel: abre o painel do balcao
  Painel->>Ctrl: GET /api/orders?store_id
  Ctrl->>Pedido: lista pedidos da filial
  Pedido-->>Ctrl: pedidos
  Ctrl-->>Painel: fila de pedidos
  Operador->>Painel: seleciona o pedido e coleta o item

  alt item encontrado na prateleira
    Operador->>Painel: informa SKU ou codigo de barras
    Painel->>Ctrl: POST /api/orders/{id}/separate
    Ctrl->>Pedido: busca o pedido e confere o status
    alt codigo nao confere (fluxo 5.2.5.2)
      Ctrl-->>Painel: 400 conferencia invalida
      Painel-->>Operador: pede nova leitura ou digitacao
    else codigo confere
      Ctrl->>Ctrl: gera voucher HV-id-salt-assinatura (HMAC-SHA256)
      Ctrl->>Pedido: status pronto_retirada + pickup_code
      Ctrl->>Notif: registra voucher liberado
      Ctrl-->>Painel: 200 pedido pronto para retirada
      Painel-->>Operador: confirma a separacao
    end
  else item em falta (fluxo 5.2.5.1, extend UC008)
    Operador->>Painel: aciona Registrar Indisponibilidade
    Painel->>Ctrl: POST /api/orders/{id}/rupture
    Ctrl->>Pedido: status cancelado_ruptura + estorno solicitado
    Ctrl->>SE: registrarRupturaFisica (zera o estoque da filial)
    Ctrl->>Notif: registra cancelamento e estorno
    Ctrl-->>Painel: 200 pedido cancelado
    Painel-->>Operador: informa o cancelamento
  end
```

## UC007 Validar Retirada

![Sequência UC007](sequencia-uc007.png)

```mermaid
sequenceDiagram
  autonumber
  actor Cliente
  actor Operador as Operador da Loja
  participant Painel as PainelBalcao (boundary)
  participant Ctrl as ControladorPedido (control) OrdersService
  participant Pedido as Pedido (entity) tabela orders
  participant Notif as Notificacao (entity)

  Cliente->>Operador: apresenta o voucher e o documento
  Operador->>Painel: abre o painel do balcao
  Painel->>Ctrl: GET /api/orders?store_id
  Ctrl->>Pedido: lista pedidos da filial
  Pedido-->>Ctrl: pedidos
  Ctrl-->>Painel: fila de pedidos (com os vouchers)
  Operador->>Painel: informa o codigo do voucher
  Painel->>Painel: procura o voucher na fila carregada

  alt voucher nao localizado (fluxo 5.3.5.2)
    Painel-->>Operador: avisa que o voucher nao foi encontrado
    Operador->>Painel: busca manual pelo CPF do titular ou do terceiro
    Painel->>Painel: procura pedido pronto para retirada com o CPF
  end
  Painel-->>Operador: mostra o titular e o terceiro autorizado
  Operador->>Painel: confere CPF e foto e confirma

  Painel->>Ctrl: POST /api/orders/validate-pickup (order_id)
  Ctrl->>Pedido: busca o pedido e confere o status
  alt pedido ja entregue ou cancelado
    Ctrl-->>Painel: 409 baixa duplicada ou pedido cancelado
  else pedido ainda nao separado
    Ctrl-->>Painel: 400 pedido nao esta pronto
  else documento nao conferido
    Ctrl-->>Painel: 400 conferencia de documento obrigatoria
  else terceiro sem autorizacao cadastrada (fluxo 5.3.5.1)
    Ctrl-->>Painel: 403 sem terceiro autorizado
  else tudo confere
    Ctrl->>Pedido: status entregue_cliente
    Ctrl->>Notif: registra a baixa (titular ou terceiro)
    Ctrl-->>Painel: 200 entrega confirmada
    Painel-->>Operador: confirma a baixa
    Operador->>Cliente: entrega o produto
  end
```

## Diferenças em relação ao texto dos casos de uso

| Caso de uso | No documento | No sistema hoje |
|---|---|---|
| UC005, passo 7 | "envia a notificação para o cliente" | a notificação é **gravada no banco**; não há e-mail |
| UC005, condição prévia | operador logado com perfil de retaguarda | **não há login** do operador (S3-14) |
| UC007, passo 2 | o operador escaneia o QR Code com leitor | o operador **digita ou cola** o código do voucher; não há leitura por câmera (S3-02) |
| UC007, fluxo 5.3.5.2 | busca por CPF e número do pedido | o painel procura pelo **CPF** do titular ou do terceiro entre os pedidos prontos da filial |
| UC007, requisito especial | modo offline | não existe (S3-01) |
