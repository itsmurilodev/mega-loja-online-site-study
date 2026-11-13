# Roteiro da apresentação da Sprint 2 (12/11)

Rascunho de 04/11/2026 para o Murilo (Scrum Master) validar com o grupo. **Todos os cinco falam**: quem não participa da apresentação fica com zero na etapa.
**Tempo total assumido: 12 minutos. É suposição: confirmar com o professor** e escalar os blocos proporcionalmente.
Itens marcados com **(se pronto)** dependem de cartões que ainda estão em andamento. Cada um tem plano B.

## 1. Quem fala e quando

| Min | Quem | Bloco | Conteúdo |
|---|---|---|---|
| 0:00 a 1:00 | Murilo | Abertura e Scrum | papéis, Trello, Sprint Goal, o que mudou desde a Sprint 1 |
| 1:00 a 2:30 | João | Requisitos | tabela RF/RNF por sprint, funcionalidades novas, prioridade da Sprint 3 |
| 2:30 a 4:30 | Júlia | Diagramas | classes, atividades, sequências de UC005 e UC007, casos de uso atualizados |
| 4:30 a 6:30 | Guilherme | Demo do cliente | pesquisa, compra, recusa de cartão, estoque insuficiente |
| 6:30 a 9:30 | Leonardo | Demo do operador | login, separação, ruptura, retirada por voucher e por terceiro |
| 9:30 a 10:45 | Guilherme e Leonardo | Qualidade e próximos passos | testes automáticos, Supabase |
| 10:45 a 12:00 | Murilo | Fechamento | resultados, riscos, plano da Sprint 3 |

## 2. Antes de começar (feito no dia 11/11, no ensaio, e refeito 12/11 de manhã)

**Terminal 1: banco limpo e API**
```bash
# banco limpo (os testes anteriores alteram o estoque)
rm -f backend/megaloja.db
# segredo do voucher: sem ele o servidor usa um aleatório a cada início
# (vouchers já emitidos continuam válidos, pois são consultados pelo valor salvo)
export PICKUP_TOKEN_SECRET="troque-por-um-segredo-qualquer"
python3 backend/app.py        # fica rodando: não feche este terminal
```

**Terminal 2: front**
```bash
python3 -m http.server 3000   # fica rodando em outro terminal
```

Cada comando fica em primeiro plano, por isso são **dois terminais separados**. Se rodados no mesmo terminal, o segundo nunca inicia.

- Estar na `main` com o **PR #1 já mergeado**: o botão "Copiar código" do voucher e o QR gerado localmente vêm dele.
- Abrir **http://127.0.0.1:3000/front.html**. **Nunca `localhost`**: no macOS a porta 5000 é do AirPlay e a API responde 403.
- **Use UMA aba só para a demo do sistema** e alterne entre as visões **Cliente** e **Balcão / Operador** pelo botão no topo da própria página. O pedido ativo do cliente fica só na memória da aba: em duas abas o voucher não aparece na do cliente, e **recarregar a página perde o pedido**. Guilherme e Leonardo apresentam no mesmo computador e na mesma aba, sem recarregar entre os blocos.
- Trello aberto no quadro, em outra aba (não é parte do sistema).
- Diagramas (PNG) e o PDF da Sprint 2 abertos antes de começar.
- **Plano B geral:** gravar um vídeo curto da demo completa no ensaio. Se a API falhar ao vivo, rodar o vídeo e comentar por cima.

## 3. Dados da demo (filial Canoas Centro, banco limpo)

| Para | Usar | Esperado |
|---|---|---|
| Compra feliz | Smartphone Android 5G Pro (`SKU-SMART-5G`, estoque 12) | pedido aguardando separação, frete R$ 0,00 |
| Recusa de cartão | mesma compra, marcando "Simular recusa financeira" (ou cartão terminando em `0000`) | mensagem de pagamento recusado |
| Estoque insuficiente | Maleta de Ferramentas (`SKU-MALETA-142`, estoque 0) | alerta de item indisponível |
| Ruptura | Sofá Retrátil (`SKU-SOFA-SUEDE`, estoque 4) | pedido cancelado, estoque da filial zerado |
| Terceiro | habilitar "Retirada por Terceiro Autorizado" no checkout com nome e CPF | operador vê os dados do terceiro |

## 4. Passo a passo

### Bloco 1: Murilo (1 min)
- Dizer os papéis e que o quadro está no Trello. Mostrar as colunas e o cartão "Como usar o quadro".
- Ler o Sprint Goal (a definir até 06/11).
- Dizer o que mudou: Sprint 1 entregou o protótipo; Sprint 2 entrega diagramas, login do operador, testes e a base do Supabase.

### Bloco 2: João (1,5 min)
- Mostrar a tabela RF/RNF por sprint (S2-05): o que está implementado, simulado, só modelado e pendente.
- Citar as funcionalidades novas do S2-13: criar conta e login, tela da empresa para produtos, pesquisa melhorada, Supabase e hospedagem.
- Dizer o que ficou **para a Sprint 3** e o que **ficou de fora** (decisão do S2-15). Ser direto: o que não será feito vai para o documento como "não implementado".

### Bloco 3: Júlia (2 min)
- Diagrama de classes (S2-02): mostrar, e dizer em uma frase que `ControladorPedido` é um papel de controle realizado por funções de `services.py`.
- Diagrama de atividades (S2-03): seguir o caminho principal e apontar os desvios (recusa, ruptura, terceiro).
- Sequências de UC005 e UC007 (S2-04): mostrar o ponto de extensão UC008.
- Classes e casos de uso **planejados** aparecem em cinza: dizer que são da Sprint 3.

### Bloco 4: Guilherme, demo do cliente (2 min)
1. Vitrine: usar a pesquisa e os filtros **(se pronto, S2-11)**. Plano B: busca por nome.
2. Selecionar o Smartphone, **Retirar na Loja**, preencher titular e finalizar. Mostrar o comprovante e o status **Aguardando Separação**.
3. Repetir com **Simular recusa financeira** marcado: mostrar a mensagem de recusa.
4. Tentar a Maleta: mostrar o alerta de item indisponível e a sugestão de outra loja.

### Bloco 5: Leonardo, demo do operador (3 min)
1. **Login do operador (S2-06) (se pronto):** mostrar que sem login a separação é recusada (401) e que com login funciona. Plano B: mostrar o teste automático que prova o 401 e dizer que a tela de login completa vem na Sprint 3 com o Supabase.
2. No painel, abrir o pedido do Smartphone. Digitar um SKU errado: mostrar o erro. Depois **Simular bipagem** e **Concluir Embalagem**.
3. Voltar à visão **Cliente** pelo botão no topo, **na mesma aba e sem recarregar**: mostrar o voucher liberado e usar o botão **Copiar código**.
4. Balcão, validação presencial: colar o voucher, **Buscar**, marcar que o documento foi conferido e **Validar Retirada**. Status final: Entregue ao Cliente.
5. **Ruptura (UC008):** comprar o Sofá, no painel clicar **Registrar Indisponibilidade**. Mostrar o pedido cancelado e o estoque da filial zerado.
6. **Terceiro:** comprar de novo com terceiro autorizado e validar a retirada mostrando os dados do terceiro.

### Bloco 6: Guilherme e Leonardo, qualidade e próximos passos (1,25 min)
- Guilherme roda `python3 -m unittest discover` ao vivo **(se pronto, S2-07)** e mostra a saída verde. Plano B: print da saída anexado ao cartão.
- Leonardo mostra o esquema do Supabase e o catálogo lido de lá **(se pronto, S2-12)**. Plano B: mostrar o esquema desenhado e dizer que a conexão é o primeiro cartão da Sprint 3.

### Bloco 7: Murilo (1,25 min)
- Resultado da sprint: cartões concluídos no Trello, o que não fechou e por quê.
- Limitações atuais, ditas por nós antes de o professor perguntar: pagamento e estoque simulados, sem HTTPS, notificações só gravadas no banco, sem modo offline.
- Plano da Sprint 3 e data da entrega do vídeo (03/12).

## 5. Perguntas que o professor pode fazer

| Pergunta | Resposta honesta |
|---|---|
| O pagamento é real? | Não. É uma simulação local com regra (cartão terminando em 0000 recusa). A integração com operadora real não está no escopo atual |
| Por que o HTTPS não está ativo? | Está no S3-03 e no S3-09, na hospedagem definitiva. Hoje roda em HTTP local |
| O QR Code é lido por câmera? | Não. O QR é gerado, mas a validação é por digitação ou cópia do código. A leitura real é item da Sprint 3, sujeita à priorização do PO |
| Onde está o ControladorPedido no código? | É um papel conceitual realizado por funções de `services.py`, não uma classe |
| Os dados persistem na hospedagem? | Ainda não: na Vercel o SQLite fica em `/tmp` e é apagado. O Supabase (S3-06) resolve |
| O que vocês deixaram de fazer? | Dizer exatamente o que o S2-15 decidiu que ficou de fora |

## 6. Regras do ensaio (11/11)

- 45 minutos, na ordem do roteiro, **com cronômetro**.
- Cada pessoa fala o seu bloco inteiro. Quem não pode estar presente avisa até 10/11.
- Congelar o código antes do ensaio: nenhum merge depois, para a demo não mudar de comportamento.
- Registrar no Trello (cartão S2-10) o resultado do ensaio e o que falhou.
