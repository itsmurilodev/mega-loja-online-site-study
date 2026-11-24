// Extras do checkout da loja (carrega depois de js/app.js e js/common.js):
//  - S3-20  entrega em casa ou retirada, por item, com endereço e frete simulado
//  - S3-25  transferência de outra filial / centro de distribuição quando falta estoque
//  - S3-22  data e horário da retirada
//  - S3-18  código de confirmação ao indicar um terceiro (e-mail simulado)
//  - S3-23  pagamento por cartão, Pix (simulado) ou os dois
// Também contém finalizarCompra().

const FRETE_SIMULADO = 19.9; // mesmo valor do backend (FRETE_SIMULADO)

let pixAtual = null; // { token, amount, txid, expiraEm, copia, expirado }
let timerPix = null;
let chaveJanelas = '';
let janelasIndisponiveis = false; // servidor sem a migração 001

// ---------------------------------------------------------------------------
// Totais e resumo
// ---------------------------------------------------------------------------
function modoDoItem(item) {
    return item.entrega === 'entrega_padrao' ? 'entrega_padrao' : 'retirar_na_loja';
}

function totaisDoCarrinho(itens) {
    const subtotal = itens.reduce((soma, it) => soma + it.produto.preco * it.qtd, 0);
    const temEntrega = itens.some((it) => modoDoItem(it) === 'entrega_padrao');
    const temRetirada = itens.some((it) => modoDoItem(it) === 'retirar_na_loja');
    const frete = temEntrega ? FRETE_SIMULADO : 0;
    return { subtotal, frete, total: subtotal + frete, temEntrega, temRetirada };
}

function atualizarResumoCarrinho(itens) {
    const { subtotal, frete, total } = totaisDoCarrinho(itens);
    const unidades = itens.reduce((soma, it) => soma + it.qtd, 0);
    document.getElementById('carrinho-resumo-itens').innerText =
        `Subtotal (${unidades} ${unidades === 1 ? 'item' : 'itens'})`;
    document.getElementById('carrinho-resumo-subtotal').innerText = formatarMoeda(subtotal);
    document.getElementById('carrinho-resumo-frete-rotulo').innerText = frete > 0 ? 'Frete da entrega (simulado)' : 'Frete Click & Collect';
    const elFrete = document.getElementById('carrinho-resumo-frete');
    elFrete.innerText = frete > 0 ? formatarMoeda(frete) : 'Grátis (R$ 0,00)';
    elFrete.className = frete > 0 ? 'font-black text-gray-900' : 'font-black text-emerald-600';
    document.getElementById('carrinho-resumo-total').innerText = formatarMoeda(total);
    document.getElementById('carrinho-resumo-pix').innerText = formatarMoeda(total);
    document.getElementById('carrinho-resumo-parcelas').innerText =
        `ou em até 12x de ${formatarMoeda(total / 12)} sem juros no cartão (simulado)`;
}

/** Chamado no fim de renderizarCarrinho(). */
function aoRenderizarCarrinho(itens) {
    // A origem de uma transferência não pode ser a própria filial de retirada.
    let mudou = false;
    carrinho.forEach((item) => {
        if (item.origem && item.origem === lojaAtiva.id) {
            delete item.origem;
            delete item.origemNome;
            delete item.eta;
            mudou = true;
        }
    });
    if (mudou) salvarCarrinho();

    const { temEntrega, temRetirada } = totaisDoCarrinho(itens);
    document.getElementById('box-entrega').classList.toggle('hidden', !temEntrega);
    if (temRetirada) carregarJanelas();
    else document.getElementById('box-janela').classList.add('hidden');
    atualizarFormaPagamento();
}

// ---------------------------------------------------------------------------
// S3-20 / S3-25: modo de cada item e transferência
// ---------------------------------------------------------------------------
function definirEntrega(produtoId, modo) {
    const item = carrinho.find((i) => i.id === produtoId);
    if (!item) return;
    item.entrega = modo;
    if (modo === 'entrega_padrao') {
        delete item.origem;
        delete item.origemNome;
        delete item.eta;
    }
    salvarCarrinho();
    renderizarCarrinho();
}

async function buscarOrigens(produtoId, quantidade, contentor) {
    contentor.textContent = 'Procurando em outras filiais e no centro de distribuição...';
    try {
        const { options } = await apiFetch(
            `/api/stores/${lojaAtiva.id}/transfer-options?product_id=${produtoId}&quantity=${quantidade}`
        );
        contentor.replaceChildren();
        if (options.length === 0) {
            contentor.textContent = 'Nenhuma outra filial nem o centro de distribuição têm essa quantidade. Escolha "Receber em casa" ou reduza a quantidade.';
            return;
        }
        options.forEach((op) => {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'text-left border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-lg px-3 py-1.5 text-[11px] font-semibold';
            botao.textContent = `Trazer de ${op.name.replace('MegaLoja - ', '')} — chega em ${op.eta_days} dia(s) útil(eis) · ${op.available} un. lá`;
            botao.addEventListener('click', () => escolherOrigem(produtoId, op));
            contentor.appendChild(botao);
        });
    } catch (err) {
        contentor.textContent = err.message;
    }
}

function escolherOrigem(produtoId, opcao) {
    const item = carrinho.find((i) => i.id === produtoId);
    if (!item) return;
    item.entrega = 'retirar_na_loja';
    item.origem = opcao.store_id;
    item.origemNome = opcao.name;
    item.eta = opcao.eta_days;
    salvarCarrinho();
    renderizarCarrinho();
    triggerToast('Transferência escolhida', `${opcao.name} envia o item para ${lojaAtiva.nome} em ${opcao.eta_days} dia(s) útil(eis).`, 'success');
}

function removerOrigem(produtoId) {
    const item = carrinho.find((i) => i.id === produtoId);
    if (!item) return;
    delete item.origem;
    delete item.origemNome;
    delete item.eta;
    salvarCarrinho();
    renderizarCarrinho();
}

// ---------------------------------------------------------------------------
// S3-22: janela de retirada
// ---------------------------------------------------------------------------
function hojeBrasilia(somarDias = 0) {
    return new Date(Date.now() - 3 * 3600_000 + somarDias * 24 * 3600_000).toISOString().slice(0, 10);
}

async function carregarJanelas() {
    const box = document.getElementById('box-janela');
    if (janelasIndisponiveis) {
        box.classList.add('hidden');
        return;
    }
    const campoData = document.getElementById('chk-janela-data');
    if (!campoData.value) {
        campoData.value = hojeBrasilia(1);
    }
    campoData.min = hojeBrasilia(0);

    const chave = `${lojaAtiva.id}|${campoData.value}`;
    if (chave === chaveJanelas && !box.classList.contains('hidden')) return;

    const select = document.getElementById('chk-janela-hora');
    const info = document.getElementById('txt-janela-info');
    try {
        const resp = await apiFetch(`/api/orders/pickup-slots?store_id=${lojaAtiva.id}&date=${campoData.value}`);
        chaveJanelas = chave;
        const anterior = select.value;
        select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Sem horário marcado' }));
        resp.slots.forEach((s) => {
            const lotado = s.available <= 0;
            const opt = document.createElement('option');
            opt.value = s.slot;
            opt.disabled = s.past || lotado;
            opt.textContent = `${s.label} — ${s.past ? 'já passou' : lotado ? 'lotado' : `${s.available} vaga(s)`}`;
            select.appendChild(opt);
        });
        if ([...select.options].some((o) => o.value === anterior && !o.disabled)) select.value = anterior;
        info.textContent = `${lojaAtiva.nome.replace('MegaLoja - ', '')} atende até ${resp.capacity} pedidos por horário.`;
        box.classList.remove('hidden');
    } catch (err) {
        // 503 = servidor sem a migração 001: esconde o recurso em vez de assustar o cliente.
        if (err.status === 503) janelasIndisponiveis = true;
        box.classList.add('hidden');
    }
}

// ---------------------------------------------------------------------------
// S3-18: código de confirmação do terceiro
// ---------------------------------------------------------------------------
async function enviarCodigoTerceiro() {
    const cpfTitular = document.getElementById('chk-cpf-cliente').value.trim();
    const cpfTerceiro = document.getElementById('chk-cpf-terceiro').value.trim();
    const aviso = document.getElementById('txt-codigo-terceiro');
    if (!cpfTitular || !cpfTerceiro) {
        triggerToast('Preencha os CPFs', 'Informe o CPF do titular e o de quem vai retirar.', 'warning');
        return;
    }
    const botao = document.getElementById('btn-enviar-codigo');
    botao.disabled = true;
    try {
        const { confirmation } = await apiFetch('/api/orders/third-party-code', {
            method: 'POST',
            body: JSON.stringify({
                customer_cpf: cpfTitular,
                third_party_cpf: cpfTerceiro,
                email: sessao ? sessao.user.email : '',
            }),
        });
        aviso.textContent = `Código enviado para ${confirmation.sent_to} (e-mail simulado, vale ${Math.round(confirmation.expires_in_seconds / 60)} min).`
            + (confirmation.code ? ` Código de demonstração: ${confirmation.code}` : '');
        aviso.className = 'sm:col-span-2 text-[11px] text-emerald-700 font-semibold';
    } catch (err) {
        aviso.textContent = err.message;
        aviso.className = 'sm:col-span-2 text-[11px] text-red-600 font-semibold';
    } finally {
        botao.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// S3-23: pagamento (cartão, Pix, ou os dois)
// ---------------------------------------------------------------------------
function formaDePagamento() {
    return document.querySelector('input[name="chk-forma"]:checked')?.value || 'cartao';
}

function lerValor(campo) {
    const texto = String(campo.value).trim();
    const n = texto.includes(',') ? Number(texto.replace(/\./g, '').replace(',', '.')) : Number(texto);
    return Number.isFinite(n) ? n : NaN;
}

function valorDoPix(total) {
    const forma = formaDePagamento();
    if (forma === 'pix') return total;
    if (forma === 'cartao+pix') {
        const noCartao = lerValor(document.getElementById('chk-valor-cartao'));
        if (Number.isFinite(noCartao) && noCartao > 0 && noCartao < total) {
            return Math.round((total - noCartao) * 100) / 100;
        }
    }
    return 0;
}

function atualizarFormaPagamento() {
    const forma = formaDePagamento();
    const itens = itensDoCarrinho();
    const { total } = totaisDoCarrinho(itens);

    document.getElementById('pg-cartao').classList.toggle('hidden', forma === 'pix');
    document.getElementById('pg-valor-cartao').classList.toggle('hidden', forma !== 'cartao+pix');
    document.getElementById('pg-pix').classList.toggle('hidden', forma === 'cartao');

    const campo = document.getElementById('chk-valor-cartao');
    if (forma === 'cartao+pix' && !campo.value && total > 0) {
        campo.value = (Math.round((total / 2) * 100) / 100).toFixed(2).replace('.', ',');
    }

    const valor = valorDoPix(total);
    document.getElementById('pix-valor').innerText = valor > 0 ? formatarMoeda(valor) : '—';
    if (pixAtual && Math.abs(pixAtual.amount - valor) > 0.004) descartarPix();
}

function descartarPix() {
    pixAtual = null;
    clearInterval(timerPix);
    document.getElementById('pix-cobranca')?.classList.add('hidden');
}

function iniciarContagemPix() {
    clearInterval(timerPix);
    const status = document.getElementById('pix-status');
    const tic = () => {
        if (!pixAtual) return;
        const restante = Math.max(0, Math.round((pixAtual.expiraEm - Date.now()) / 1000));
        if (restante === 0) {
            pixAtual.expirado = true;
            status.textContent = 'Pix expirado. Gere um novo QR Code para pagar.';
            status.className = 'font-bold text-red-600';
            clearInterval(timerPix);
        } else {
            status.textContent = `Pix pronto (simulado). Expira em ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, '0')}.`;
            status.className = 'font-bold text-emerald-800';
        }
    };
    tic();
    timerPix = setInterval(tic, 1000);
}

async function gerarPix() {
    const itens = itensDoCarrinho();
    if (itens.length === 0) return;
    const botao = document.getElementById('btn-gerar-pix');
    botao.disabled = true;
    try {
        // O total vem do servidor (itens + frete), para o Pix bater com a cobrança.
        const cotacao = await apiFetch('/api/orders/quote', {
            method: 'POST',
            body: JSON.stringify(montarCorpoBase(itens, true)),
        });
        const valor = valorDoPix(cotacao.total);
        if (valor <= 0) {
            triggerToast('Informe o valor do cartão', 'No pagamento dividido, o valor no cartão deve ser menor que o total.', 'warning');
            return;
        }
        const { pix } = await apiFetch('/api/payments/pix', {
            method: 'POST',
            body: JSON.stringify({ amount: valor }),
        });
        pixAtual = {
            token: pix.token,
            amount: pix.amount,
            txid: pix.txid,
            expiraEm: new Date(pix.expires_at).getTime(),
            copia: pix.copia_e_cola,
            expirado: false,
        };
        document.getElementById('pix-copia-cola').value = pix.copia_e_cola;
        document.getElementById('pix-qr').src =
            `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(pix.copia_e_cola)}`;
        document.getElementById('pix-cobranca').classList.remove('hidden');
        iniciarContagemPix();
    } catch (err) {
        triggerToast('Não foi possível gerar o Pix', err.message, 'warning');
    } finally {
        botao.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// Finalizar compra (carrinho -> /api/orders/checkout)
// ---------------------------------------------------------------------------
function montarCorpoBase(itens, paraCotacao = false) {
    const nome = document.getElementById('chk-nome-cliente').value.trim();
    const cpf = document.getElementById('chk-cpf-cliente').value.trim();
    const comTerceiro = document.getElementById('chk-habilitar-terceiro').checked;
    const corpo = {
        customer_name: nome || 'Cliente',
        customer_cpf: cpf,
        delivery_method: 'retirar_na_loja',
        store_id: lojaAtiva.id,
        items: itens.map((it) => {
            const linha = { product_id: it.produto.id, quantity: it.qtd, delivery: modoDoItem(it) };
            if (it.origem) linha.transfer_from = it.origem;
            return linha;
        }),
    };
    if (totaisDoCarrinho(itens).temEntrega) {
        corpo.shipping_address = document.getElementById('chk-endereco').value.trim();
    }
    if (paraCotacao) return corpo;

    const slot = document.getElementById('chk-janela-hora').value;
    if (slot && totaisDoCarrinho(itens).temRetirada) corpo.pickup_slot = slot;
    if (comTerceiro) {
        corpo.third_party_name = document.getElementById('chk-nome-terceiro').value.trim();
        corpo.third_party_cpf = document.getElementById('chk-cpf-terceiro').value.trim();
        corpo.third_party_code = document.getElementById('chk-codigo-terceiro').value.trim();
    }
    return corpo;
}

async function finalizarCompra() {
    if (finalizando) return;
    const itens = itensDoCarrinho();
    if (itens.length === 0) {
        triggerToast('Carrinho vazio', 'Adicione produtos antes de finalizar.', 'warning');
        return;
    }

    const semEstoque = itens.filter((it) =>
        modoDoItem(it) === 'retirar_na_loja' && !it.origem && estoqueNaFilial(it.produto) < it.qtd);
    if (semEstoque.length > 0) {
        triggerToast('Ajuste o carrinho', `${semEstoque[0].produto.nome} não tem estoque suficiente nesta filial: peça a transferência ou escolha entrega em casa.`, 'warning');
        return;
    }

    const nome = document.getElementById('chk-nome-cliente').value.trim();
    const cpf = document.getElementById('chk-cpf-cliente').value.trim();
    const comTerceiro = document.getElementById('chk-habilitar-terceiro').checked;
    const { temEntrega, total } = totaisDoCarrinho(itens);

    if (!nome || !cpf) {
        triggerToast('Dados incompletos', 'Preencha o nome e o CPF do titular.', 'warning');
        return;
    }
    if (comTerceiro) {
        const nomeT = document.getElementById('chk-nome-terceiro').value.trim();
        const cpfT = document.getElementById('chk-cpf-terceiro').value.trim();
        const codigo = document.getElementById('chk-codigo-terceiro').value.trim();
        if (!nomeT || !cpfT) {
            triggerToast('Dados de quem vai retirar', 'Preencha o nome e o CPF da pessoa autorizada.', 'warning');
            return;
        }
        if (!/^\d{6}$/.test(codigo)) {
            triggerToast('Confirme o terceiro', 'Peça o código por e-mail e digite os 6 dígitos para autorizar quem vai retirar.', 'warning');
            return;
        }
    }
    if (temEntrega && document.getElementById('chk-endereco').value.trim().length < 8) {
        triggerToast('Endereço de entrega', 'Informe o endereço completo para os itens com entrega.', 'warning');
        return;
    }

    const corpo = montarCorpoBase(itens);
    const forma = formaDePagamento();
    const cartao = document.getElementById('chk-cartao-numero').value.trim();
    const recusar = document.getElementById('chk-simular-recusa').checked;

    if (forma === 'cartao') {
        corpo.card_number = cartao;
        corpo.simulate_payment_failure = recusar;
    } else {
        if (!pixAtual) {
            triggerToast('Gere o Pix', 'Clique em "Gerar QR Code Pix" antes de finalizar.', 'warning');
            return;
        }
        if (pixAtual.expirado || pixAtual.expiraEm <= Date.now()) {
            triggerToast('Pix expirado', 'O QR Code expirou. Gere um novo para pagar.', 'warning');
            return;
        }
        const metodos = [];
        if (forma === 'cartao+pix') {
            const noCartao = lerValor(document.getElementById('chk-valor-cartao'));
            if (!Number.isFinite(noCartao) || noCartao <= 0 || noCartao >= total) {
                triggerToast('Valor no cartão', 'Informe um valor no cartão maior que zero e menor que o total.', 'warning');
                return;
            }
            metodos.push({ type: 'cartao', card_number: cartao, amount: Math.round(noCartao * 100) / 100, simulate_failure: recusar });
        }
        metodos.push({ type: 'pix', pix_token: pixAtual.token, amount: pixAtual.amount });
        corpo.payment = { methods: metodos };
    }

    const botao = document.getElementById('btn-finalizar');
    finalizando = true;
    botao.disabled = true;

    try {
        const resp = await apiFetch('/api/orders/checkout', { method: 'POST', body: JSON.stringify(corpo) });

        const criados = resp.orders || [];
        guardarPedidosLocais(criados);
        pedidosNovos = criados.map((o) => o.id);

        // Abate o estoque na memória (da filial ou da origem da transferência) para a vitrine refletir a compra.
        criados.forEach((o) => {
            if (o.delivery_method !== 'retirar_na_loja') return;
            const produto = dbProdutos.find((p) => p.id === o.product_id);
            const lojaFisica = o.origin_store_id || lojaAtiva.id;
            if (produto) produto.estoques[lojaFisica] = Math.max(0, Number(produto.estoques[lojaFisica] || 0) - o.quantity);
        });

        carrinho = [];
        salvarCarrinho();
        descartarPix();
        document.getElementById('chk-codigo-terceiro').value = '';
        executarFiltrosCombinados();
        await abrirPedidos(criados);
        triggerToast('Pedido confirmado!', 'A filial já recebeu a ordem de separação.', 'success');
    } catch (err) {
        triggerToast('Não foi possível finalizar', err.message, 'warning');
        // O estoque pode ter mudado: atualiza o catálogo para o cliente ajustar o carrinho.
        if (err.status === 409) {
            chaveJanelas = '';
            await carregarDadosBackend();
            renderizarCarrinho();
            executarFiltrosCombinados();
        }
    } finally {
        finalizando = false;
        botao.disabled = false;
    }
}
