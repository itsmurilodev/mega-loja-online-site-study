# Diagrama de atividades (S2-03)

> Gerado a partir do código da `main` em 12/11/2026 (backend NestJS + Supabase). É a versão em Mermaid, que o GitHub desenha sozinho; a imagem está em `atividades.png`. O cartão pede também o arquivo `.drawio`: para isso, no Draw.io use Organizar > Inserir > Avançado > Mermaid e cole o bloco abaixo. Falta a revisão da Júlia e do João.

Fluxo principal compra, separação e retirada, com os desvios: sem estoque, pagamento recusado, SKU errado, ruptura, expiração, voucher não localizado e retirada por terceiro.

![Diagrama de atividades](atividades.png)

```mermaid
flowchart TD
  inicio([Inicio]) --> vitrine[Cliente escolhe o produto e a filial]
  vitrine --> estoque{Ha estoque na filial? UC002}
  estoque -- Nao --> semEstoque[Sistema avisa a indisponibilidade - 409]
  semEstoque --> outraLoja{Cliente escolhe outra filial?}
  outraLoja -- Sim --> vitrine
  outraLoja -- Nao --> fimSemCompra([Fim sem compra])
  estoque -- Sim --> dados[Cliente informa titular, terceiro opcional e cartao]
  dados --> pagamento{Operadora aprova? simulado}
  pagamento -- Nao --> recusa[Sistema informa pagamento recusado - 402]
  recusa --> dados
  pagamento -- Sim --> criar[Sistema cria o pedido Aguardando Separacao, reserva o estoque e registra notificacao]
  criar --> fila[Pedido aparece na fila do balcao da filial]

  fila --> coleta[Operador coleta o item na prateleira]
  coleta --> achou{Item esta na prateleira?}
  achou -- Nao --> ruptura[Operador registra a ruptura UC008]
  ruptura --> cancelRuptura[Sistema cancela o pedido, zera o estoque da filial e registra o estorno]
  cancelRuptura --> fimRuptura([Fim: Cancelado por Ruptura])
  achou -- Sim --> confere[Operador informa o SKU ou codigo de barras]
  confere --> skuOk{Codigo confere?}
  skuOk -- Nao --> erroSku[Sistema recusa a conferencia - 400]
  erroSku --> confere
  skuOk -- Sim --> pronto[Sistema muda para Pronto para Retirada, gera o voucher HMAC e registra notificacao]

  pronto --> compareceu{Cliente comparece em ate 7 dias?}
  compareceu -- Nao --> expira[Operador expira o pedido]
  expira --> cancelExp[Sistema cancela, devolve o estoque e registra o estorno]
  cancelExp --> fimExp([Fim: Cancelado por Expiracao])
  compareceu -- Sim --> busca[Operador informa o voucher]
  busca --> achouPedido{Voucher valido?}
  achouPedido -- Nao --> manual[Operador busca por CPF ou numero do pedido - fluxo 5.3.5.2]
  manual --> terceiro
  achouPedido -- Sim --> terceiro{Quem retira e terceiro?}
  terceiro -- Sim --> temTerceiro{Terceiro foi cadastrado na compra?}
  temTerceiro -- Nao --> negado[Sistema recusa a retirada - 403]
  negado --> fimNegado([Fim: retirada nao realizada])
  temTerceiro -- Sim --> doc
  terceiro -- Nao --> doc[Operador confere CPF e foto do documento]
  doc --> docOk{Documento conferido?}
  docOk -- Nao --> erroDoc[Sistema exige a conferencia - 400]
  erroDoc --> doc
  docOk -- Sim --> baixa[Sistema registra Entregue ao Cliente e a notificacao de baixa]
  baixa --> fim([Fim: pedido entregue])
```

## Notas

- Os códigos HTTP entre parênteses são os que a API devolve em cada desvio; todos estão cobertos pelos testes de contrato (`tests/contract/`, PR #8).
- A expiração por abandono **não é automática**: o operador aciona o botão no painel e a API cancela e devolve o estoque.
- O pagamento e o estoque são simulados, como no diagrama de classes.
