# Auditoria de acessibilidade (S2-20, RNF006)

Feita em 12/11/2026 no site publicado (https://study-mega-loja-online-site.vercel.app/), para gerar a lista de correções do cartão S3-29. Nada foi corrigido aqui.

## Resultado

**RNF006 (WCAG 2.1 AA): verificado em parte, e não atendido.** A auditoria automática encontrou falhas de nível AA e a leitura do HTML encontrou outras que a ferramenta não cobre.

| Verificação | Como | Resultado |
|---|---|---|
| Lighthouse 13.6, categoria Acessibilidade, desktop | automática, tela inicial (vitrine) | nota 89 de 100, 2 falhas |
| Lighthouse 13.6, categoria Acessibilidade, celular | automática, tela inicial (vitrine) | nota 89 de 100, as mesmas 2 falhas |
| Leitura do HTML (`frontend/front.html`) | estática, todas as telas | 4 problemas prováveis, listados abaixo |
| Navegação só por teclado | manual | **não feita** |
| Leitor de tela | manual | **não feito** |

## Falhas confirmadas pelo Lighthouse

| # | Problema | Onde | Critério WCAG |
|---|---|---|---|
| 1 | Contraste insuficiente: texto cinza claro (`text-gray-400`, #9ca3af) sobre branco tem 2,53:1; o mínimo é 4,5:1. 11 elementos | rótulo "Filial de retirada", títulos da barra lateral, contador de produtos, SKU nos cartões e outros textos pequenos | 1.4.3 Contraste (AA) |
| 2 | Botão sem nome acessível: o botão da lupa na busca só tem um ícone | cabeçalho | 4.1.2 Nome, função, valor (A) |

O botão "Balcão / Operador" inativo também fica no limite (4,39:1).

## Problemas prováveis vistos no HTML (a confirmar no teste manual)

| # | Problema | Onde | Critério WCAG |
|---|---|---|---|
| 3 | Elementos clicáveis que não recebem foco do teclado: são `div` com `onclick`, sem `tabindex` nem `role` | escolha da filial de retirada (abre o modal) e logotipo (volta à vitrine) | 2.1.1 Teclado (A) |
| 4 | O modal de filiais não se declara como diálogo (`role="dialog"`, `aria-modal`) e o HTML não mostra controle de foco | modal de filiais | 4.1.2 e 2.4.3 Ordem do foco (A) |
| 5 | Os avisos que aparecem no canto (pedido confirmado, erros) não têm `aria-live`, então um leitor de tela não os anuncia | toda a aplicação | 4.1.3 Mensagens de status (AA) |
| 6 | Campos com o rótulo ao lado, mas sem ligação por `for` ou `aria-label` | checkout (nome, CPF, terceiro, cartão, CVV) e balcão (SKU, voucher, CPF, pedido) | 1.3.1 e 3.3.2 Rótulos (A) |

## O que não foi coberto

- O Lighthouse só avalia o que está visível ao abrir a página. **Checkout, comprovante e painel do balcão ficam escondidos nesse momento e não foram auditados pela ferramenta.**
- Faltam o teste só com teclado e o teste com leitor de tela, que o cartão pede.
- Não há prints anexados.

## O que passou

Idioma da página declarado (`pt-BR`), imagens com texto alternativo, um título principal e a área `main` definidos, e foco visível nos campos de texto.

## Como repetir

```bash
npx lighthouse https://study-mega-loja-online-site.vercel.app/ --only-categories=accessibility --preset=desktop
```
