# Documento da Sprint 2: esqueleto

Universidade LaSalle · Laboratório de Engenharia de Software · Trabalho G2 · **Sprint 2** (apresentação em 12/11/2026)

> **Como usar este arquivo (Murilo)**
> - Segue as seções do documento da Sprint 1, atualizadas, e acrescenta as seções novas exigidas pela Sprint 2 (classes e atividades).
> - O que está **escrito** vem de evidência já verificada (código, Trello, roteiro ponta a ponta de 04/11). O que está em **⟦PREENCHER⟧** tem dono e prazo.
> - Cada seção indica o cartão do Trello que a alimenta. Quando o cartão fechar, o dono cola o texto aqui ou comenta no cartão e o conteúdo é incorporado.
> - Versão final em PDF no S2-10. Exportar do Google Docs ou do Markdown.

---

## 1. Integrantes e papéis (Scrum)

| Integrante | Papel |
|---|---|
| Murilo Alves | Scrum Master |
| João Vitor G. Valli | Product Owner |
| Leonardo Quadros | Desenvolvedor |
| Guilherme Reis | Desenvolvedor |
| Júlia Normando | Analista de Requisitos e Testes |

**Sprint 2:** 04/11 a 12/11/2026. **Sprint 3:** 13/11 a 03/12/2026.
**Sprint Goal:** ⟦PREENCHER (Murilo, até 06/11): uma frase. Sugestão: "Entregar a Sprint 2 com classes, atividades e sequências coerentes com o código, login do operador e testes automatizados rodando."⟧

### 1.1 Definição do sistema
*(mantida da Sprint 1)* O Sistema Central de Click & Collect unifica o ambiente de compras digitais ao estoque das lojas físicas: o cliente compra pelo site e retira o produto em uma filial de sua preferência. Elimina a falta de padronização no agendamento de retiradas, reduz o custo de separação manual, evita viagens perdidas e controla estornos.

**Evoluções planejadas (decididas em 04/11):** pesquisa melhorada, criar conta e login, tela da empresa para cadastrar produtos, persistência no Supabase, hospedagem definitiva e link novo. A distribuição entre Sprint 2 e Sprint 3 está na seção 14.

## 2. Atores

| Ator | Descrição | Situação |
|---|---|---|
| Cliente | compra, escolhe a filial, recebe o voucher e retira | existente |
| Operador da Loja | separa, embala e valida a retirada | existente |
| Sistema de Estoque (S.E.) | disponibilidade por loja, reserva e baixa | **simulado** (SQLite local) |
| Operadora de Cartão | autoriza a cobrança | **simulada** (regra local) |
| Empresa (administrador do catálogo) | cadastra e edita produtos e estoque | **planejado, Sprint 3** |

## 3. Diagrama de casos de uso

⟦PREENCHER (Júlia e João, S2-04 e S2-13, até 09/11): diagrama atualizado, com UC001 a UC008 preservados.⟧

**Casos de uso novos propostos** (numeração a confirmar pelo PO):

| ID | Nome | Ator | Sprint |
|---|---|---|---|
| UC009 | Criar conta | Cliente, Operador, Empresa | 3 |
| UC010 | Autenticar (login) | todos | 2 (operador, simples) e 3 (completo) |
| UC011 | Cadastrar e editar produto | Empresa | 3 |
| UC012 | Pesquisar produtos | Cliente | 2 |

## 4. Casos de uso especificados em detalhe

UC003 Finalizar Compra · UC005 Separar Pedido · UC007 Validar Retirada.
Texto das especificações: seção 5 do documento da Sprint 1, com as correções abaixo.

## 5. Atualizações das especificações

| Caso de uso | Ajuste | Cartão | Dono |
|---|---|---|---|
| UC005 | Condição prévia nova: operador autenticado | S2-06 | João e Júlia |
| UC005 | Passo final "envia a notificação para o cliente" passa a "registra a notificação no sistema" (não há e-mail) | S2-04 | João e Júlia |
| UC007 | Passo 2 "O operador utiliza o leitor para escanear o QR Code" passa a "o operador informa ou cola o código do voucher" (sem leitor integrado) | S2-04 | João e Júlia |
| UC003 | Pagamento descrito como **simulado** e estoque como **local** | S2-04 | João e Júlia |
| todos | Decisão registrada sobre `/expire` e o status `cancelado_expirado` (documentar ou deixar de fora) | S2-04 | João |

## 6. Relações entre casos de uso

Mantidas: `<<include>>` UC003→UC002 e `<<extend>>` UC008→UC005.
⟦PREENCHER (Júlia): relações dos casos de uso novos, se houver.⟧

## 7. Diagramas de sequência (padrão BCE)

| Caso de uso | Situação | Cartão |
|---|---|---|
| UC003 Finalizar Compra | entregue na Sprint 1 | |
| UC005 Separar Pedido | ⟦PREENCHER (Júlia, 09/11)⟧ | S2-04 |
| UC007 Validar Retirada | ⟦PREENCHER (Júlia, 09/11)⟧ | S2-04 |

**Nota de rastreabilidade:** o controle `ControladorPedido` aparece nos diagramas como papel conceitual. No código ele é realizado por funções de módulo em `backend/services.py`, não por uma classe.

## 8. Diagrama de classes (novo)

⟦PREENCHER (Júlia, S2-02, 09/11): diagrama final redesenhado no Draw.io, `.drawio` + `.png` em `documentacao/diagramas/`.⟧
Ponto de partida: `documentacao/diagramas/classes-rascunho.md` (PR #2): 17 classes, 19 relações, gerado do código em 04/11.

**Observações a incluir no texto:**
1. `ControladorPedido` é um papel de controle, não uma classe.
2. `Pedido` guarda um produto e uma quantidade; não há item de pedido.
3. A coluna `discount_coupon` é legado de uma funcionalidade removida.
4. `Usuario`, `Empresa` e `Papel` estão **planejados para a Sprint 3**.

## 9. Diagrama de atividades (novo)

⟦PREENCHER (Júlia, S2-03, 09/11): fluxo principal compra → separação → retirada, com os desvios: pagamento recusado, ruptura, voucher inválido e retirada por terceiro.⟧

## 10. Requisitos

### 10.1 Requisitos funcionais

| ID | Requisito | Sprint | Situação em 12/11 |
|---|---|---|---|
| RF001 | Seleção de filial para retirada | 1 | implementado |
| RF002 | Consulta de estoque em tempo real | 1 | **simulado** (SQLite local; sem sistema externo) |
| RF003 | Pagamento online com frete gratuito | 1 | **simulado** (sem operadora externa) |
| RF004 | Notificação e envio de QR Code | 1 | **parcial**: voucher e QR gerados no navegador; notificação gravada no banco, **sem e-mail** |
| RF005 | Painel de separação com conferência de código | 1 | implementado (digitação; sem leitor) |
| RF006 | Registro de ruptura de estoque | 1 | implementado (estorno só **registrado**) |
| RF007 | Validação presencial da retirada | 1 | implementado (código digitado ou colado, e busca por CPF; sem câmera) |
| RF008 | Criar conta | 3 | ⟦PO confirma⟧ |
| RF009 | Autenticação e papéis (cliente, operador, empresa) | 2 e 3 | ⟦PO confirma⟧ |
| RF010 | Cadastro e edição de produtos pela empresa | 3 | ⟦PO confirma⟧ |
| RF011 | Pesquisa de produtos com filtros e ordenação | 2 | ⟦depende do S2-11⟧ |

### 10.2 Requisitos não funcionais

| ID | Requisito | Sprint | Situação em 12/11 |
|---|---|---|---|
| RNF001 | Resposta e sincronização ≤ 60 s | 1 | **não medido** (S3-03) |
| RNF002 | HTTPS/SSL | 1 | **pendente** no ambiente local (HTTP). ⟦confirmar o estado na hospedagem⟧ |
| RNF003 | Voucher autêntico (HMAC) | 1 | implementado: assinatura HMAC-SHA256, código único, reuso bloqueado (testado em 04/11) |
| RNF004 | Operação offline | 1 | **pendente** (S3-01, sujeita à priorização do S2-15) |
| RNF005 | Painel responsivo e acessível | 1 | **parcial** (S2-08) |
| RNF006 | Persistência em banco gerenciado (Supabase) | 3 | planejado (S2-12 prepara, S3-06 migra) |
| RNF007 | Hospedagem pública com link estável | 2 e 3 | planejado (S2-14, S3-09) |

**Mínimo exigido pelo trabalho: 6 funcionalidades.** ⟦PREENCHER (João, S2-05): listar quais funcionalidades estão implementadas, para comprovar.⟧

## 11. Ferramentas e links

| Ferramenta | Uso | Link |
|---|---|---|
| Trello | gestão Scrum | https://trello.com/b/cDD8UJdr |
| Trello (histórico da Sprint 1) | | https://trello.com/b/BYBoKsAI |
| GitHub | código e documentação | https://github.com/itsmurilodev/mega-loja-online-site-study |
| Draw.io | diagramas UML | |
| Vercel | hospedagem | ⟦PREENCHER (Murilo, S2-14): link novo⟧ |
| Supabase | banco gerenciado | ⟦PREENCHER (Murilo e Leonardo, S2-12)⟧ |

## 12. Situação da implementação na Sprint 2

| Cartão | O que entrega | Dono | Situação | Evidência |
|---|---|---|---|---|
| S2-01 | pendências da Sprint 1 no Git | Murilo | PR #1 aberto | link do PR |
| S2-06 | login do operador (401 sem credencial) | Leonardo | ⟦a atualizar⟧ | ⟦teste⟧ |
| S2-07 | testes automatizados | Guilherme | ⟦a atualizar⟧ | ⟦saída do unittest⟧ |
| S2-08 | front separado e responsivo | Guilherme | ⟦a atualizar⟧ | ⟦print em ~360px⟧ |
| S2-11 | pesquisa melhorada | Guilherme | ⟦a atualizar⟧ | ⟦print⟧ |
| S2-12 | Supabase: projeto, esquema e leitura | Murilo e Leonardo | ⟦a atualizar⟧ | ⟦esquema⟧ |
| S2-14 | link novo na Vercel | Murilo | ⟦a atualizar⟧ | ⟦link⟧ |

### 12.1 Validação ponta a ponta (04/11/2026, banco limpo)

**13 de 14 verificações passaram.**
Passaram: compra OK; pagamento recusado (402); estoque insuficiente (409); SKU errado (400); separação com voucher; retirada sem confirmar documento (400); retirada por voucher; voucher reutilizado recusado (409); retirada por terceiro; busca manual por CPF e pedido; ruptura com cancelamento, estoque zerado e notificações.
Falhou, como esperado: separar **sem credencial** retorna 200 (endpoint aberto). Cartão S2-06.
⟦ATUALIZAR após o S2-06 e o S2-07 (Leonardo e Guilherme).⟧

### 12.2 Limitações assumidas
Pagamento e estoque simulados; notificações só gravadas no banco, sem e-mail; HTTP no ambiente local; sem modo offline; sem leitura de QR por câmera; um produto por pedido.

## 13. Gestão da Sprint (Scrum)

| Cerimônia | Data | Registro |
|---|---|---|
| Planning | 04 a 05/11 | ⟦PREENCHER (Murilo): o que foi decidido⟧ |
| Daily | diária | ⟦canal e horário⟧ |
| Checkpoint | 09/11 | ⟦decisões: corte de itens, ordem dos merges⟧ |
| Ensaio | 11/11 | ⟦resultado⟧ |
| Review | 12/11 | apresentação ao professor |
| Retrospectiva | 13/11 | ⟦manter, parar, melhorar⟧ |

**Impedimentos:** ⟦listar os registrados no Trello, com dono e como foram resolvidos⟧.
**Cartões da Sprint:** ⟦concluídos / total, extraído do Trello em 12/11⟧.

## 14. Planejamento da Sprint 3 (13/11 a 03/12)

Ordem: o Supabase vem primeiro, o resto depende dele.

| Cartão | Item | Dono |
|---|---|---|
| S3-06 | Migrar persistência para o Supabase | Leonardo |
| S3-07 | Login e criar conta (Supabase Auth) | Leonardo e Guilherme |
| S3-08 | Tela da empresa para cadastrar produtos | Guilherme e Leonardo |
| S3-09 | Hospedagem definitiva com Supabase | Murilo e Leonardo |
| S3-03 | HTTPS, segredos e medição de tempo | Leonardo e Guilherme |
| S3-01, S3-02, S3-10 | Modo offline, leitura real de QR, notificação do QR | sujeitos à priorização do PO |

**Prioridade decidida pelo PO (S2-15):** ⟦PREENCHER (João, até 09/11): Deve / Podia / Fica de fora.⟧
**Itens que ficarem de fora** entram aqui como "não implementado".
Código congela por volta de 24/11 para gravar o vídeo (25/11 a 01/12). Entrega: 03/12.

---

## Anexo A: Correções ao documento da Sprint 1 (para a Sprint 2 não repetir)

| Onde | Texto da Sprint 1 | Correção |
|---|---|---|
| RF004 (8.1) e 5.2.4 | "enviá-lo por e-mail/notificação ao cliente" e "envia a notificação para o cliente" | notificação registrada no banco, sem e-mail |
| 5.3.4, passo 2 | "O operador utiliza o leitor para escanear o QR Code exibido na tela do celular do cliente" | operador informa ou cola o código; sem leitor integrado |
| Seção 7 | `ControladorPedido` como classe | papel de controle realizado por funções de `services.py` |
| Seção 9.1 | link do Trello antigo | https://trello.com/b/cDD8UJdr |
| Seção 11 | situação da Sprint 1 | substituída pela seção 12 deste documento |

## Anexo B: Quem preenche o quê

| Seção | Dono | Cartão | Prazo |
|---|---|---|---|
| 1 (Sprint Goal), 11, 13 | Murilo | S2-10, S2-12, S2-14 | 11/11 |
| 3, 5, 6, 10 (requisitos novos) | João e Júlia | S2-04, S2-13 | 09/11 |
| 7, 8, 9 | Júlia | S2-02, S2-03, S2-04 | 09/11 |
| 10.1 e 10.2 (tabela por sprint) | João | S2-05 | 09/11 |
| 12 | Leonardo e Guilherme | S2-06, S2-07, S2-08, S2-11 | 10 e 11/11 |
| 14 (prioridade) | João | S2-15 | 09/11 |

**Como entregar o texto:** comentar no cartão com o modelo abaixo, ou abrir PR com o arquivo em `documentacao/`.

```text
Cartão: S2-0X
Feito: (1 a 2 linhas)
Evidência: (link do PR, nome do arquivo ou print anexado)
Falta / bloqueio: (o que e quem pode destravar)
Próximo: (o que faço até quando)
```
