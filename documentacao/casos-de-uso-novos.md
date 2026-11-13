# Requisitos e casos de uso das novas funcionalidades (S2-13)

Rascunho de 12/11/2026 para a Júlia e o João. Descreve o que entra no documento como **planejado para a Sprint 3**, sem contradizer o que o código faz hoje. A numeração dos RFs é a do documento "Requisitos para revisar"; a confirmação é do PO.

## Ator novo

| Ator | Descrição | Situação |
|---|---|---|
| Empresa (administrador do catálogo) | Cadastra e edita produtos, imagens, preços e estoque por filial | planejado, Sprint 3 |

Os atores Cliente e Operador da Loja passam a ter conta e login.

## Casos de uso novos

| ID | Nome | Ator principal | RF relacionado | Situação em 12/11 | Cartão |
|---|---|---|---|---|---|
| UC009 | Criar conta | Cliente | RF001 | não existe | S3-07 |
| UC010 | Autenticar (login) | Cliente, Operador da Loja, Empresa | RF001, RF003 | não existe; o painel do balcão abre sem login | S3-07 e S3-14 |
| UC011 | Cadastrar e editar produto | Empresa | (sem RF no documento do PO) | não existe; os produtos são inseridos direto no banco | S3-08 |
| UC012 | Pesquisar produtos | Cliente | RF007 | **implementado em 12/11**: busca por nome, categoria, SKU e código de barras, filtro por estoque na filial e ordenação | S2-11 |
| UC013 | Gerenciar carrinho | Cliente | RF015 | não existe; a compra é de um produto por vez | S3-15 |

### UC009 - Criar conta (resumo)

- **Fluxo básico:** o cliente informa nome, e-mail, CPF e senha; o sistema valida os dados, cria a conta e o deixa autenticado.
- **Alternativos:** e-mail ou CPF já cadastrado; senha fraca.
- **Pós-condição:** conta criada com o papel Cliente.

### UC010 - Autenticar (resumo)

- **Fluxo básico:** o usuário informa e-mail e senha; o sistema confere as credenciais e abre a sessão com o papel correspondente (cliente, operador ou empresa).
- **Alternativos:** credenciais inválidas; operador tentando acessar pedidos de outra filial (RF003).
- **Relação:** UC003, UC005, UC007 e UC008 passam a **incluir** UC010. Hoje as condições prévias "cliente autenticado" (UC003) e "operador logado" (UC005) estão no texto, mas o sistema não as exige.

### UC011 - Cadastrar e editar produto (resumo)

- **Fluxo básico:** a Empresa informa nome, categoria, preço, imagem, SKU, código de barras e o estoque por filial; o sistema grava e o produto aparece na vitrine.
- **Alternativos:** SKU duplicado; preço inválido.
- **Observação:** o documento do PO não tem um RF para isto. Sugestão: criar um RF novo (por exemplo RF027) ou tratar como parte do RF006.

### UC012 - Pesquisar produtos (resumo)

- **Fluxo básico:** o cliente digita um ou mais termos; o sistema lista os produtos que contêm todos os termos, sem diferenciar maiúsculas nem acentos; o cliente pode filtrar por faixa de preço, categoria e estoque na filial, e ordenar o resultado.
- **Alternativo:** nenhum produto encontrado; o sistema oferece limpar a busca e os filtros.

### UC013 - Gerenciar carrinho (resumo)

- **Fluxo básico:** o cliente adiciona produtos, altera quantidades, remove itens e vê o subtotal; ao avançar, segue para UC003.
- **Impacto:** exige mudar o modelo de dados, porque hoje o pedido guarda um único produto.

## Requisitos não funcionais novos

| Tema | Situação em 12/11 | Cartão |
|---|---|---|
| Persistência em banco gerenciado (Supabase Postgres) | **implementado**: o site publicado lê e grava no Supabase | S2-12 |
| Hospedagem pública | **implementado**: backend NestJS na Vercel | S3-09 |

O documento do PO não lista esses dois como RNF. Sugestão: registrar no documento oficial como decisões de arquitetura, não como requisitos.

## O que falta para o cartão

- Diagrama de casos de uso redesenhado com o ator Empresa e os UC009 a UC013 marcados como planejados.
- Confirmação do João sobre a numeração (UC e RF) e sobre o RF do cadastro de produtos.
- Levar o texto aprovado para as seções 2, 3 e 8 do documento oficial.
