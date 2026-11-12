# Requisitos: situação real em 12/11/2026 (S2-05 e S2-18)

Tabela de apoio para o João (S2-05, tabela de RF e RNF por sprint) e para a Júlia e o João (S2-18, reclassificar amarelos e roxos).

- **Numeração:** a do documento "Requisitos para revisar" (RF001 a RF026 e RNF001 a RNF006). Ela é diferente da numeração do PDF da Sprint 1 (RF001 a RF007 e RNF001 a RNF005); a decisão sobre qual vale é do João.
- **Como foi verificado:** leitura do código da `main` (backend NestJS em `backend/src`, front em `frontend/`), o site em produção e os testes de contrato (`tests/contract/`, 34 casos passando em 12/11).
- **Situação possível:** *tem* (funciona no site), *simulado* (funciona, mas sem o sistema externo real), *parcial* (falta parte do texto do requisito), *não tem*.
- A coluna **Sprint** é uma sugestão do Scrum Master a partir dos cartões do Trello; a priorização é do PO (S2-15).

## Requisitos funcionais

| ID | Requisito | Cor no doc do João | Situação verificada | Evidência ou lacuna | Sprint / cartão |
|---|---|---|---|---|---|
| RF001 | Autenticação de cliente | vermelho | não tem | Não há login nem conta no front ou na API | 3 · S3-07 |
| RF002 | MFA ao indicar terceiro | vermelho | não tem | Sem envio de código por SMS ou e-mail | 3 · S3-18 |
| RF003 | Autenticação de operador por filial | vermelho | não tem | O painel do balcão abre sem login; os endpoints do operador respondem sem credencial | 3 · S3-07 e S3-14 |
| RF004 | Papéis no painel (operador, gerente) | amarelo | não tem | Depende do login | 3 · S3-16 |
| RF005 | Log de auditoria do operador | amarelo | não tem | Só existem notificações por pedido, sem usuário | 3 · S3-17 |
| RF006 | Descrição, garantia e ficha técnica | vermelho | parcial | Página do produto mostra descrição, garantia e ficha com dados de exemplo (PR #9, em produção). Não aparece no carrinho, que não existe | 2 · S2-19 |
| RF007 | Filtro por disponibilidade na loja | verde | tem | A vitrine mostra o estoque da filial escolhida; filtro "Somente com estoque" em produção (PR #10) | 2 · S2-11 |
| RF008 | Avaliações e resenhas | vermelho | não tem | | 3 · S3-19 |
| RF009 | Checkout misto por item | verde e vermelho | não tem | Cada pedido tem um produto. A API aceita `entrega_padrao`, mas o front só oferece retirada na loja | 3 · S3-20 |
| RF010 | Bloqueio de produtos incompatíveis | vermelho | não tem | | 3 · S3-21 |
| RF011 | Terceiro autorizado para retirada | verde | tem | Nome e CPF do terceiro no checkout; retirada por terceiro testada (HTTP 200) e recusada sem cadastro (403) | 1 |
| RF012 | Agendar data e horário da retirada | vermelho | não tem | | 3 · S3-22 |
| RF013 | Pagamento online com cartão | roxo | simulado | `OperadoraCartaoService` aprova ou recusa por regra local; recusa testada (HTTP 402). Não há operadora real | 1 |
| RF014 | Pix e combinação de meios | vermelho | não tem | | 3 · S3-23 |
| RF015 | Carrinho de compras | vermelho | não tem | A compra é direta, um produto por vez | 3 · S3-15 |
| RF016 | Consulta de estoque em tempo real (UC002) | verde | simulado | A consulta existe e bloqueia a compra sem estoque (HTTP 409), mas o "Sistema de Estoque" é a tabela `inventory` do próprio banco | 1 |
| RF017 | Reserva de estoque com prazo | vermelho | parcial | A compra reserva o estoque. Não há prazo automático: a liberação depende da expiração manual | 3 · S3-24 |
| RF018 | Transferência entre filiais ou CD | vermelho | não tem | A mensagem de falta só sugere outra filial | 3 · S3-25 |
| RF019 | Painel de separação de pedidos | verde | tem | Fila por filial, conferência por SKU ou código de barras digitado, status Pronto para Retirada. | 1 |
| RF020 | Registro de ruptura de estoque | verde | tem | Cancela o pedido e zera o estoque da filial; o estorno é apenas registrado | 1 |
| RF021 | Validação presencial da retirada | verde | tem | Código do voucher digitado ou colado e busca por CPF; sem leitura por câmera (S3-02) | 1 |
| RF022 | Cancelar pedidos não retirados | vermelho | parcial | Existe a expiração (`/expire`), que cancela, devolve o estoque e registra o estorno, mas é acionada pelo operador, não automática | 3 |
| RF023 | Devolução ou troca no balcão | vermelho | não tem | | 3 · S3-26 |
| RF024 | Notificação e envio do QR Code | roxo | parcial | O voucher e o QR aparecem na tela do comprovante e a notificação é gravada no banco. Não há e-mail. A imagem do QR é gerada por um serviço externo (`api.qrserver.com`), que recebe o código do voucher | 1 · S3-10 |
| RF025 | Acompanhar status em tempo real | roxo | parcial | O status aparece no comprovante da compra enquanto a aba está aberta. Não há conta, WhatsApp nem push | 3 · S3-28 |
| RF026 | Histórico de pedidos e QR na conta | vermelho | não tem | Depende do login | 3 · S3-27 |

## Requisitos não funcionais

| ID | Requisito | Cor no doc do João | Situação verificada | Evidência ou lacuna | Sprint / cartão |
|---|---|---|---|---|---|
| RNF001 | Resposta e sincronização em até 60 s | verde | tem (medido) | A API mede cada consulta e reserva de estoque e expõe em `/api/health` e `/api/metrics/rnf001`. Em 12/11 as consultas levaram entre 0,4 e 0,9 s. A medição fica na memória da instância e zera quando ela reinicia | 3 · S3-03 |
| RNF002 | Operação offline do operador | roxo | não tem | Não há cache local nem service worker | 3 · S3-01 |
| RNF003 | HTTPS para dados sensíveis | roxo | tem (na hospedagem) | O site na Vercel só responde por HTTPS, com cabeçalho HSTS. A API guarda apenas o cartão mascarado. Rodando localmente é HTTP | 3 · S3-03 |
| RNF004 | Voucher autêntico (HMAC) | verde | tem | Voucher `HV-pedido-salt-assinatura` com HMAC-SHA256 e segredo em variável de ambiente; reuso bloqueado (HTTP 409, testado). Limite: a assinatura usa 4 caracteres e a conferência é feita pelo código gravado no banco | 1 |
| RNF005 | Design responsivo | verde | parcial (não medido) | O front usa classes responsivas e foi separado no S2-08. Não foi testado em 320 px nesta verificação | 2 · S2-08 |
| RNF006 | Acessibilidade WCAG 2.1 AA | roxo | não atendido (verificado em parte) | Lighthouse deu 89 de 100 na vitrine, com falhas de contraste e um botão sem nome; ver `acessibilidade-auditoria.md`. Teclado e leitor de tela não testados | 2 · S2-20 e 3 · S3-29 |

## Funcionalidades implementadas (mínimo de 6 exigido)

Funcionam hoje, de ponta a ponta, no site e na API:

1. Vitrine com estoque por filial e escolha da filial de retirada.
2. Compra com retirada na loja, frete zero e reserva de estoque (UC003), com recusa por falta de estoque.
3. Pagamento com cartão simulado, incluindo o fluxo de recusa.
4. Indicação de terceiro autorizado para a retirada.
5. Separação do pedido com conferência de SKU e geração do voucher assinado (UC005).
6. Registro de ruptura com cancelamento e estorno registrado (UC008).
7. Validação presencial da retirada por voucher ou CPF, com bloqueio de baixa duplicada (UC007).
8. Expiração de pedido não retirado, com devolução do estoque.

Também em produção desde 12/11: (9) ficha técnica do produto com dados de exemplo e (10) pesquisa com filtros e ordenação.

## Reclassificação sugerida dos amarelos e roxos (S2-18)

| ID | Cor atual | Sugestão | Motivo |
|---|---|---|---|
| RF004 | amarelo | deve adicionar | não existe e depende do login |
| RF005 | amarelo | deve adicionar | não existe |
| RF013 | roxo | simulado | funciona com regra local, sem operadora |
| RF024 | roxo | parcial | QR e notificação existem, e-mail não |
| RF025 | roxo | deve adicionar | só o comprovante mostra o status |
| RNF002 | roxo | deve adicionar | offline não existe |
| RNF003 | roxo | tem | HTTPS ativo na hospedagem |
| RNF006 | roxo | deve adicionar | a auditoria do S2-20 encontrou falhas de nível AA |

A decisão final sobre os amarelos é do João.
