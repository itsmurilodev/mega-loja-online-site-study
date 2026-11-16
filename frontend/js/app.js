// Loja do cliente (front.html): vitrine, produto, carrinho com vários itens, pedidos e conta.
// Depende de js/common.js (API_BASE_URL, criarApiFetch, esc, formatarMoeda, triggerToast...).

const CHAVE_SESSAO = 'megaloja_sessao';
const CHAVE_CARRINHO = 'megaloja_carrinho';
const CHAVE_PEDIDOS = 'megaloja_pedidos';
const CHAVE_FILIAL = 'megaloja_filial';
const LIMITE_POR_ITEM = 20;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let dbProdutos = [];
let dbLojas = {};
let lojaAtiva = { id: 1, nome: 'MegaLoja - Filial Canoas Centro', endereco: '', cidade: 'Canoas' };
let lojaTemp = lojaAtiva;
let produtoSelecionado = null;
let filtroPrecoAtivo = 'todos';
let categoriaAtiva = 'todos';
let abaAtual = 'vitrine';
let finalizando = false;
let pedidosNovos = [];
let timerPedidos = null;

let sessao = lerStorage(localStorage, CHAVE_SESSAO, null); // { access_token, user }
let carrinho = lerStorage(localStorage, CHAVE_CARRINHO, []); // [{ id, qtd, entrega?, origem?, origemNome?, eta? }]
if (!Array.isArray(carrinho)) carrinho = [];

const apiFetch = criarApiFetch({
    getToken: () => (sessao ? sessao.access_token : null),
    aoNaoAutorizado: () => {
        encerrarSessaoLocal();
        triggerToast('Sessão expirada', 'Entre novamente para continuar.', 'warning');
    },
});

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
window.addEventListener('load', async () => {
    atualizarInterfaceCliente();
    await carregarDadosBackend();
    renderizarCategorias();
    executarFiltrosCombinados();
    renderizarLojasModal();
    atualizarLayoutFocoLoja();
    atualizarBadgeCarrinho();
    mudarAba('vitrine');
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    fecharModalLoja();
    fecharModalAuthCliente();
});

async function carregarDadosBackend() {
    try {
        const [produtosResp, lojasResp] = await Promise.all([
            apiFetch('/api/products?include=stock'),
            apiFetch('/api/stores'),
        ]);

        dbProdutos = produtosResp.products.map((p) => ({
            id: p.id,
            nome: p.name,
            categoria: p.category,
            preco: Number(p.price),
            sku: p.sku || `SKU-${p.id}`,
            barcode: p.barcode || `7891000${p.id}`,
            img: p.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80',
            estoques: p.stocks || {},
        }));

        const lojasAgrupadas = {};
        lojasResp.stores.forEach((loja) => {
            const chave = slugCidade(loja.city);
            (lojasAgrupadas[chave] ||= []).push({
                id: loja.id,
                nome: loja.name,
                endereco: loja.address,
                cidade: loja.city,
            });
        });
        dbLojas = lojasAgrupadas;

        const todas = Object.values(dbLojas).flat();
        const salva = Number(lerStorage(localStorage, CHAVE_FILIAL, 0));
        lojaAtiva = todas.find((l) => l.id === salva)
            || dbLojas['canoas']?.[0]
            || todas[0]
            || lojaAtiva;
        lojaTemp = lojaAtiva;

        // Tira do carrinho produtos que saíram do catálogo.
        const idsValidos = new Set(dbProdutos.map((p) => p.id));
        const filtrado = carrinho.filter((item) => idsValidos.has(item.id));
        if (filtrado.length !== carrinho.length) {
            carrinho = filtrado;
            salvarCarrinho();
        }
    } catch (err) {
        console.warn('Backend indisponível:', err);
        triggerToast('Servidor indisponível', 'Não foi possível carregar o catálogo. Tente novamente em instantes.', 'warning');
    }
}

function estoqueNaFilial(produto) {
    return Number(produto.estoques[lojaAtiva.id] || 0);
}

// ---------------------------------------------------------------------------
// Navegação entre telas
// ---------------------------------------------------------------------------
function mudarAba(destino) {
    abaAtual = destino;
    ['vitrine', 'detalhe', 'carrinho', 'pedidos'].forEach((aba) => {
        document.getElementById(`aba-${aba}`)?.classList.add('hidden');
    });
    document.getElementById(`aba-${destino}`)?.classList.remove('hidden');
    document.getElementById('wrapper-banner')?.classList.toggle('hidden', destino !== 'vitrine');

    clearInterval(timerPedidos);
    if (destino === 'pedidos') {
        timerPedidos = setInterval(() => carregarPedidosCliente(false), 20000);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function irParaVitrine() {
    mudarAba('vitrine');
}

// ---------------------------------------------------------------------------
// Vitrine
// ---------------------------------------------------------------------------
const ROTULOS_CATEGORIA = {
    eletronicos: ['Eletrônicos', 'fa-tv'],
    casa: ['Ferramentas & Casa', 'fa-screwdriver-wrench'],
    eletrodomesticos: ['Eletrodomésticos', 'fa-couch'],
};

function rotuloCategoria(chave) {
    if (ROTULOS_CATEGORIA[chave]) return ROTULOS_CATEGORIA[chave];
    const texto = String(chave || 'Outros');
    return [texto.charAt(0).toUpperCase() + texto.slice(1), 'fa-tag'];
}

// Os departamentos vêm do catálogo: produto novo com categoria nova ganha o seu botão.
function renderizarCategorias() {
    const barra = document.getElementById('barra-categorias');
    if (!barra) return;
    const categorias = [...new Set(dbProdutos.map((p) => p.categoria))].sort();
    const botoes = [['todos', 'Todos os Departamentos', 'fa-border-all'],
        ...categorias.map((c) => [c, ...rotuloCategoria(c)])];

    barra.replaceChildren();
    botoes.forEach(([chave, rotulo, icone]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = `cat-${chave}`;
        btn.dataset.categoria = chave;
        btn.addEventListener('click', () => filtrarCategoria(chave));
        const i = document.createElement('i');
        i.className = `fa-solid ${icone} mr-1`;
        btn.append(i, document.createTextNode(` ${rotulo}`));
        barra.appendChild(btn);
    });
    marcarCategoriaAtiva();
}

function marcarCategoriaAtiva() {
    document.querySelectorAll('#barra-categorias button').forEach((btn) => {
        btn.className = btn.dataset.categoria === categoriaAtiva
            ? 'bg-white text-blue-700 px-3 py-1 rounded-lg font-bold shadow-sm whitespace-nowrap'
            : 'hover:bg-blue-700 px-3 py-1 rounded-lg transition-colors whitespace-nowrap';
    });
}

function renderizarVitrine(lista) {
    const grid = document.getElementById('grid-produtos');
    grid.innerHTML = '';
    document.getElementById('contador-produtos').innerText = `${lista.length} produtos disponíveis`;

    if (lista.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-16 bg-white rounded-2xl border border-gray-200 text-gray-400 font-medium text-xs">
                <i class="fa-solid fa-box-open text-4xl block mb-2 text-gray-300"></i> Nenhum produto encontrado para estes filtros.
                <button type="button" onclick="limparFiltrosVitrine()" class="block mx-auto mt-3 text-blue-600 hover:text-blue-800 font-bold underline">Limpar busca e filtros</button>
            </div>`;
        return;
    }

    lista.forEach((p) => {
        const qtdEstoque = estoqueNaFilial(p);
        const card = document.createElement('article');
        card.className = 'bg-white border border-gray-200 rounded-2xl p-4 flex flex-col justify-between hover:shadow-xl transition-all duration-300 group cursor-pointer hover:border-blue-400';
        card.addEventListener('click', () => carregarDetalhesProduto(p.id));

        card.innerHTML = `
            <div>
                <div class="w-full h-44 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden border border-gray-100 mb-4 relative">
                    <img src="${esc(p.img)}" alt="${esc(p.nome)}" class="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300">
                </div>
                <span class="text-[9px] font-black text-blue-600 uppercase tracking-wider bg-blue-50 px-2 py-0.5 rounded">${esc(p.categoria)}</span>
                <h3 class="font-bold text-xs text-gray-800 mt-2 line-clamp-2 min-h-[32px] group-hover:text-blue-600 transition-colors">${esc(p.nome)}</h3>
                <p class="text-[10px] text-gray-400 font-mono mt-1">SKU: ${esc(p.sku)}</p>
            </div>
            <div class="mt-4 pt-3 border-t border-gray-100 space-y-3">
                <div class="flex justify-between items-baseline">
                    <span class="text-base font-black text-slate-950">${formatarMoeda(p.preco)}</span>
                    <span class="text-[9px] font-black ${qtdEstoque > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'} px-2 py-0.5 rounded">
                        <i class="fa-solid ${qtdEstoque > 0 ? 'fa-circle-check' : 'fa-clock'} mr-0.5"></i> ${qtdEstoque > 0 ? `${qtdEstoque} un. na filial` : 'Sem estoque na filial'}
                    </span>
                </div>
                <div class="flex gap-2">
                    <button type="button" data-acao="comprar" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                        <i class="fa-solid fa-bag-shopping text-[11px]"></i> Comprar
                    </button>
                    <button type="button" data-acao="adicionar" class="px-3 bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 rounded-xl text-xs transition-colors" title="Adicionar ao carrinho" aria-label="Adicionar ${esc(p.nome)} ao carrinho">
                        <i class="fa-solid fa-cart-plus"></i>
                    </button>
                </div>
            </div>`;

        card.querySelector('[data-acao="comprar"]').addEventListener('click', (e) => {
            e.stopPropagation();
            adicionarAoCarrinho(p.id, 1, true);
        });
        card.querySelector('[data-acao="adicionar"]').addEventListener('click', (e) => {
            e.stopPropagation();
            adicionarAoCarrinho(p.id, 1, false);
        });
        grid.appendChild(card);
    });
}

// ---------------------------------------------------------------------------
// Ficha do produto
// ---------------------------------------------------------------------------
// RF006 (S2-19): descricao, garantia e ficha tecnica, indexadas pelo SKU do catalogo.
const FICHAS_PRODUTO = {
    'SKU-TV-55': {
        descricao: 'Smart TV de 55 polegadas com resolução 4K e HDR, que deixa filmes e jogos com mais contraste e cores vivas. Conecta por Wi-Fi e Bluetooth e já vem com os principais aplicativos de streaming.',
        garantia: '12 meses de garantia do fabricante contra defeitos de fabricação.',
        ficha: { 'Dimensões (L x A x P)': '123,1 x 71,0 x 6,0 cm (sem base)', 'Peso': '14,2 kg', 'Voltagem': 'Bivolt (100 a 240 V)', 'Cor': 'Preto', 'Material': 'Gabinete em plástico ABS, painel LED' }
    },
    'SKU-SMART-5G': {
        descricao: 'Smartphone 5G com 256 GB de armazenamento e câmera tripla para fotos nítidas de dia e de noite. Tela ampla, bateria para o dia inteiro e carregamento rápido.',
        garantia: '12 meses de garantia do fabricante (90 dias para o carregador e o cabo).',
        ficha: { 'Dimensões (L x A x P)': '7,6 x 16,3 x 0,8 cm', 'Peso': '195 g', 'Voltagem': 'Carregador bivolt (100 a 240 V)', 'Cor': 'Preto grafite', 'Material': 'Vidro e alumínio' }
    },
    'SKU-FURAD-12': {
        descricao: 'Furadeira de impacto profissional com mandril de 1/2 polegada e função reversível, para furar madeira, metal e alvenaria. Empunhadura lateral e limitador de profundidade inclusos.',
        garantia: '6 meses de garantia do fabricante.',
        ficha: { 'Dimensões (L x A x P)': '28,0 x 21,0 x 7,5 cm', 'Peso': '1,9 kg', 'Voltagem': '127 V', 'Cor': 'Vermelho e preto', 'Material': 'Corpo em polímero reforçado, mandril em aço' }
    },
    'SKU-MALETA-142': {
        descricao: 'Maleta com 142 peças em aço cromo vanádio: soquetes, catracas, chaves combinadas, alicates e bits. Organizada em estojo rígido com trava, para oficina ou manutenção doméstica.',
        garantia: '3 meses de garantia legal contra defeitos de fabricação.',
        ficha: { 'Dimensões (L x A x P)': '44,0 x 33,0 x 10,0 cm', 'Peso': '8,7 kg', 'Voltagem': 'Não se aplica', 'Cor': 'Preto e laranja', 'Material': 'Aço cromo vanádio, estojo em polipropileno' }
    },
    'SKU-GELAD-410': {
        descricao: 'Geladeira duplex frost free de 410 litros com acabamento inox e painel digital externo. Prateleiras de vidro temperado e gavetão para frutas e legumes.',
        garantia: '12 meses de garantia do fabricante (10 anos para o compressor).',
        ficha: { 'Dimensões (L x A x P)': '70,0 x 186,0 x 73,0 cm', 'Peso': '72 kg', 'Voltagem': '127 V ou 220 V (conferir na retirada)', 'Cor': 'Inox', 'Material': 'Aço com acabamento inox, prateleiras em vidro temperado' }
    },
    'SKU-SOFA-SUEDE': {
        descricao: 'Sofá retrátil de 3 lugares revestido em tecido suede, com assentos que avançam e encosto reclinável. Espuma de alta densidade para uso diário.',
        garantia: '12 meses de garantia para a estrutura e 3 meses para o tecido.',
        ficha: { 'Dimensões (L x A x P)': '230 x 95 x 110 cm (fechado)', 'Peso': '68 kg', 'Voltagem': 'Não se aplica', 'Cor': 'Verde', 'Material': 'Estrutura em eucalipto, revestimento em suede' }
    }
};

const FICHA_NAO_CADASTRADA = {
    descricao: 'Descrição detalhada ainda não cadastrada para este produto.',
    garantia: '3 meses de garantia legal (Código de Defesa do Consumidor).',
    ficha: {}
};

function renderizarFichaProduto(produto) {
    const dados = FICHAS_PRODUTO[produto.sku] || FICHA_NAO_CADASTRADA;

    document.getElementById('detalhe-descricao').textContent = dados.descricao;
    document.getElementById('detalhe-garantia').textContent = dados.garantia;

    const lista = document.getElementById('detalhe-ficha-tecnica');
    lista.replaceChildren();
    const itens = Object.entries(dados.ficha);
    if (itens.length === 0) {
        itens.push(['Ficha técnica', 'Não cadastrada']);
    }
    itens.forEach(([rotulo, valor]) => {
        const linha = document.createElement('div');
        linha.className = 'flex justify-between gap-4 px-3 py-2';
        const termo = document.createElement('dt');
        termo.className = 'text-gray-500 font-semibold shrink-0';
        termo.textContent = rotulo;
        const descricao = document.createElement('dd');
        descricao.className = 'text-gray-900 font-medium text-right';
        descricao.textContent = valor;
        linha.append(termo, descricao);
        lista.appendChild(linha);
    });
}

function carregarDetalhesProduto(id) {
    produtoSelecionado = dbProdutos.find((p) => p.id === id);
    if (!produtoSelecionado) return;
    const p = produtoSelecionado;

    document.getElementById('detalhe-categoria').textContent = p.categoria;
    document.getElementById('detalhe-nome').textContent = p.nome;
    document.getElementById('detalhe-preco').textContent = formatarMoeda(p.preco);
    document.getElementById('detalhe-preco-pix').textContent = formatarMoeda(p.preco * 0.95);
    document.getElementById('detalhe-economia-pix').textContent = formatarMoeda(p.preco * 0.05);
    document.getElementById('detalhe-parcelamento').textContent = `ou 12x de ${formatarMoeda(p.preco / 12)} sem juros`;
    document.getElementById('detalhe-codigos').textContent = `SKU: ${p.sku} | Cód. barras: ${p.barcode}`;

    const img = document.getElementById('detalhe-imagem');
    img.src = p.img;
    img.alt = p.nome;

    renderizarFichaProduto(p);
    atualizarLayoutFocoLoja();
    mudarAba('detalhe');
}

function adicionarProdutoSelecionado(irParaCarrinho) {
    if (!produtoSelecionado) {
        triggerToast('Escolha um produto', 'Selecione um produto na vitrine.', 'warning');
        return;
    }
    adicionarAoCarrinho(produtoSelecionado.id, 1, irParaCarrinho);
}

// ---------------------------------------------------------------------------
// Carrinho (vários itens, guardado no navegador)
// ---------------------------------------------------------------------------
function salvarCarrinho() {
    gravarStorage(localStorage, CHAVE_CARRINHO, carrinho);
    atualizarBadgeCarrinho();
}

/** Quantidade máxima do item: o estoque da filial, ou o limite geral quando vem de transferência/entrega. */
function limiteDoItem(item, produto) {
    if (item.entrega === 'entrega_padrao' || item.origem) return LIMITE_POR_ITEM;
    return Math.max(1, Math.min(estoqueNaFilial(produto), LIMITE_POR_ITEM));
}

function itemSemEstoque(item) {
    return (item.entrega || 'retirar_na_loja') === 'retirar_na_loja'
        && !item.origem
        && estoqueNaFilial(item.produto) < item.qtd;
}

function totalDeItens() {
    return carrinho.reduce((soma, item) => soma + item.qtd, 0);
}

function atualizarBadgeCarrinho() {
    const badge = document.getElementById('nav-carrinho-badge');
    if (badge) badge.innerText = String(totalDeItens());
}

function adicionarAoCarrinho(produtoId, qtd = 1, abrir = false) {
    const produto = dbProdutos.find((p) => p.id === produtoId);
    if (!produto) return;

    const estoque = estoqueNaFilial(produto);
    const existente = carrinho.find((item) => item.id === produtoId);
    const limite = existente ? limiteDoItem(existente, produto) : (estoque > 0 ? Math.min(estoque, LIMITE_POR_ITEM) : LIMITE_POR_ITEM);
    const atual = existente ? existente.qtd : 0;

    if (estoque <= 0 && !existente) {
        // S3-25 / S3-20: sem estoque na filial o item entra no carrinho e o cliente escolhe
        // trazer de outra filial/CD ou receber em casa.
        triggerToast('Sem estoque nesta filial', `${produto.nome} está em falta em ${lojaAtiva.nome}. No carrinho você pode pedir a transferência de outra filial ou escolher entrega em casa.`, 'warning');
    }

    if (atual >= limite) {
        triggerToast('Limite atingido', `Só há ${estoque} un. de ${produto.nome} nesta filial.`, 'warning');
    } else {
        const novaQtd = Math.min(atual + qtd, limite);
        if (existente) existente.qtd = novaQtd;
        else carrinho.push({ id: produtoId, qtd: novaQtd });
        salvarCarrinho();
        triggerToast('Adicionado ao carrinho', `${produto.nome} (${novaQtd} no carrinho)`, 'success');
    }

    if (abrir) abrirCarrinho();
    else if (abaAtual === 'carrinho') renderizarCarrinho();
}

function alterarQuantidade(produtoId, delta) {
    const item = carrinho.find((i) => i.id === produtoId);
    const produto = dbProdutos.find((p) => p.id === produtoId);
    if (!item || !produto) return;

    const limite = limiteDoItem(item, produto);
    const nova = item.qtd + delta;
    if (nova < 1) {
        removerDoCarrinho(produtoId);
        return;
    }
    if (nova > limite) {
        triggerToast('Limite atingido', `Só há ${estoqueNaFilial(produto)} un. de ${produto.nome} nesta filial.`, 'warning');
        return;
    }
    item.qtd = nova;
    salvarCarrinho();
    renderizarCarrinho();
}

function removerDoCarrinho(produtoId) {
    carrinho = carrinho.filter((i) => i.id !== produtoId);
    salvarCarrinho();
    renderizarCarrinho();
}

function limparCarrinho() {
    if (carrinho.length === 0) return;
    if (!confirm('Remover todos os itens do carrinho?')) return;
    carrinho = [];
    salvarCarrinho();
    renderizarCarrinho();
}

function abrirCarrinho() {
    renderizarCarrinho();
    mudarAba('carrinho');
}

function itensDoCarrinho() {
    return carrinho
        .map((item) => ({ ...item, produto: dbProdutos.find((p) => p.id === item.id) }))
        .filter((item) => item.produto);
}

function renderizarCarrinho() {
    const itens = itensDoCarrinho();
    const conteudo = document.getElementById('carrinho-conteudo');
    const vazio = document.getElementById('carrinho-vazio');
    conteudo.classList.toggle('hidden', itens.length === 0);
    vazio.classList.toggle('hidden', itens.length > 0);

    const lista = document.getElementById('lista-carrinho');
    lista.replaceChildren();

    let semEstoque = 0;

    itens.forEach((it) => {
        const { produto, qtd } = it;
        const estoque = estoqueNaFilial(produto);
        const entrega = it.entrega === 'entrega_padrao';
        const problema = itemSemEstoque(it);
        if (problema) semEstoque += 1;

        const linha = document.createElement('div');
        linha.className = 'flex flex-col gap-3 py-4 first:pt-0 last:pb-0';
        const situacao = entrega
            ? 'Será entregue no seu endereço (frete simulado).'
            : it.origem
                ? `Vem de ${it.origemNome ? it.origemNome.replace('MegaLoja - ', '') : 'outra filial'} — chega em ${it.eta} dia(s) útil(eis) na filial.`
                : problema
                    ? `Só ${estoque} un. disponíveis nesta filial — ajuste a quantidade, peça transferência ou receba em casa.`
                    : `${estoque} un. disponíveis na filial`;
        linha.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:items-center gap-4">
            <div class="flex items-center gap-4 flex-1 min-w-0">
                <div class="w-20 h-20 bg-gray-50 rounded-xl p-2 border border-gray-100 flex items-center justify-center shrink-0">
                    <img src="${esc(produto.img)}" alt="" class="max-h-full max-w-full object-contain">
                </div>
                <div class="min-w-0">
                    <span class="text-[9px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded">${esc(produto.categoria)}</span>
                    <h3 class="font-bold text-sm text-gray-900 mt-1 truncate">${esc(produto.nome)}</h3>
                    <p class="text-[10px] text-gray-400 font-mono mt-0.5">SKU: ${esc(produto.sku)}</p>
                    <p class="text-[10px] font-bold mt-1 ${problema ? 'text-red-600' : 'text-emerald-600'}">${esc(situacao)}</p>
                </div>
            </div>
            <div class="flex items-center justify-between sm:justify-end gap-5 shrink-0">
                <div class="flex items-center border border-gray-300 rounded-xl overflow-hidden" role="group" aria-label="Quantidade de ${esc(produto.nome)}">
                    <button type="button" data-delta="-1" class="px-3 py-1.5 text-gray-700 hover:bg-gray-100 font-black" aria-label="Diminuir quantidade">−</button>
                    <span class="px-3 text-xs font-black min-w-[2rem] text-center" aria-live="polite">${qtd}</span>
                    <button type="button" data-delta="1" class="px-3 py-1.5 text-gray-700 hover:bg-gray-100 font-black" aria-label="Aumentar quantidade">+</button>
                </div>
                <div class="text-right min-w-[88px]">
                    <span class="text-[10px] text-gray-400 block font-semibold uppercase">Valor</span>
                    <span class="text-base font-black text-gray-900">${formatarMoeda(produto.preco * qtd)}</span>
                </div>
                <button type="button" data-remover class="text-gray-400 hover:text-red-600 p-2" title="Remover do carrinho" aria-label="Remover ${esc(produto.nome)} do carrinho">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[11px]" role="group" aria-label="Como receber ${esc(produto.nome)}">
                <button type="button" data-modo="retirar_na_loja" class="px-3 py-1.5 rounded-lg border font-bold ${entrega ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-blue-600 bg-blue-50 text-blue-800'}">Retirar na loja</button>
                <button type="button" data-modo="entrega_padrao" class="px-3 py-1.5 rounded-lg border font-bold ${entrega ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}">Receber em casa</button>
                ${problema ? '<button type="button" data-origens class="px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 text-amber-900 font-bold">Buscar em outra filial / CD</button>' : ''}
                ${it.origem ? '<button type="button" data-sem-origem class="text-gray-500 hover:text-red-600 underline">Cancelar transferência</button>' : ''}
            </div>
            <div data-origens-lista class="flex flex-col gap-1.5 text-[11px] text-gray-500"></div>`;

        linha.querySelectorAll('[data-delta]').forEach((btn) => {
            btn.addEventListener('click', () => alterarQuantidade(produto.id, Number(btn.dataset.delta)));
        });
        linha.querySelector('[data-remover]').addEventListener('click', () => removerDoCarrinho(produto.id));
        linha.querySelectorAll('[data-modo]').forEach((btn) => {
            btn.addEventListener('click', () => definirEntrega(produto.id, btn.dataset.modo));
        });
        linha.querySelector('[data-origens]')?.addEventListener('click', () =>
            buscarOrigens(produto.id, qtd, linha.querySelector('[data-origens-lista]')));
        linha.querySelector('[data-sem-origem]')?.addEventListener('click', () => removerOrigem(produto.id));
        lista.appendChild(linha);
    });

    atualizarResumoCarrinho(itens);

    const info = document.getElementById('txt-status-loja-info');
    if (info) {
        if (itens.length === 0) {
            info.className = 'text-[11px] font-medium text-gray-500 mt-0.5';
            info.textContent = '—';
        } else if (semEstoque > 0) {
            info.className = 'text-[11px] font-semibold text-red-600 mt-0.5';
            info.textContent = `${semEstoque} ${semEstoque === 1 ? 'item sem' : 'itens sem'} estoque suficiente nesta filial`;
        } else {
            info.className = 'text-[11px] font-semibold text-emerald-600 mt-0.5';
            info.textContent = 'Todos os itens têm estoque nesta filial';
        }
    }

    atualizarLayoutFocoLoja();
    preencherDadosDoTitular();
    aoRenderizarCarrinho(itens);
}

function toggleCamposTerceiro() {
    const habilitado = document.getElementById('chk-habilitar-terceiro').checked;
    document.getElementById('box-terceiro').classList.toggle('hidden', !habilitado);
}

function preencherDadosDoTitular() {
    if (!sessao) return;
    const nome = document.getElementById('chk-nome-cliente');
    const cpf = document.getElementById('chk-cpf-cliente');
    if (nome && !nome.value) nome.value = sessao.user.name || '';
    if (cpf && !cpf.value) cpf.value = sessao.user.cpf || '';
}

// ---------------------------------------------------------------------------
// Filtros e busca
// ---------------------------------------------------------------------------
function filtrarCategoria(cat) {
    categoriaAtiva = cat;
    marcarCategoriaAtiva();
    document.getElementById('titulo-vitrine').innerText =
        cat === 'todos' ? 'Todos os Departamentos' : rotuloCategoria(cat)[0];
    executarFiltrosCombinados();
    if (abaAtual !== 'vitrine') mudarAba('vitrine');
}

function filtrarPorPreco(range) {
    filtroPrecoAtivo = range;
    executarFiltrosCombinados();
}

function filtrarPorNome() {
    // Quem digita na busca estando em outra tela volta para a vitrine.
    if (abaAtual !== 'vitrine') mudarAba('vitrine');
    executarFiltrosCombinados();
}

// S2-11: busca sem diferenciar maiusculas nem acentos ("eletronicos" acha "Eletrônicos").
function normalizarTexto(texto) {
    return String(texto)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function produtoCombinaComBusca(produto, termos) {
    const textoDoProduto = normalizarTexto(
        `${produto.nome} ${produto.categoria} ${produto.sku} ${produto.barcode}`
    );
    return termos.every((termo) => textoDoProduto.includes(termo));
}

const ORDENACOES_VITRINE = {
    'menor-preco': (a, b) => a.preco - b.preco,
    'maior-preco': (a, b) => b.preco - a.preco,
    'nome': (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    'estoque': (a, b) => estoqueNaFilial(b) - estoqueNaFilial(a)
};

function limparFiltrosVitrine() {
    document.getElementById('input-busca').value = '';
    document.getElementById('filtro-com-estoque').checked = false;
    document.getElementById('ordenacao-vitrine').value = 'padrao';
    document.querySelector('input[name="filtro-preco"][value="todos"]').checked = true;
    filtroPrecoAtivo = 'todos';
    filtrarCategoria('todos');
}

function executarFiltrosCombinados() {
    let resultado = dbProdutos;
    if (categoriaAtiva !== 'todos') {
        resultado = resultado.filter((p) => p.categoria === categoriaAtiva);
    }
    if (filtroPrecoAtivo === 'ate500') {
        resultado = resultado.filter((p) => p.preco <= 500);
    } else if (filtroPrecoAtivo === 'de500a2000') {
        resultado = resultado.filter((p) => p.preco > 500 && p.preco <= 2000);
    } else if (filtroPrecoAtivo === 'acima2000') {
        resultado = resultado.filter((p) => p.preco > 2000);
    }
    const termos = normalizarTexto(document.getElementById('input-busca').value)
        .split(/\s+/)
        .filter(Boolean);
    if (termos.length > 0) {
        resultado = resultado.filter((p) => produtoCombinaComBusca(p, termos));
    }
    if (document.getElementById('filtro-com-estoque').checked) {
        resultado = resultado.filter((p) => estoqueNaFilial(p) > 0);
    }
    const comparar = ORDENACOES_VITRINE[document.getElementById('ordenacao-vitrine').value];
    if (comparar) {
        resultado = [...resultado].sort(comparar);
    }
    renderizarVitrine(resultado);
}

// ---------------------------------------------------------------------------
// Filial de retirada
// ---------------------------------------------------------------------------
function abrirModalLoja() {
    lojaTemp = lojaAtiva;
    const seletor = document.getElementById('seletor-cidade');
    seletor.value = slugCidade(lojaAtiva.cidade || '');
    renderizarLojasModal();
    const m = document.getElementById('modal-loja');
    const c = document.getElementById('modal-content');
    m.classList.remove('hidden');
    setTimeout(() => { m.classList.remove('opacity-0'); c.classList.remove('scale-95'); }, 15);
}

function fecharModalLoja() {
    const m = document.getElementById('modal-loja');
    const c = document.getElementById('modal-content');
    if (m.classList.contains('hidden')) return;
    m.classList.add('opacity-0'); c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 200);
}

function renderizarLojasModal() {
    const seletor = document.getElementById('seletor-cidade');
    if (seletor.options.length === 0) {
        Object.entries(dbLojas).forEach(([chave, lojas]) => {
            const opt = document.createElement('option');
            opt.value = chave;
            opt.textContent = lojas[0].cidade;
            seletor.appendChild(opt);
        });
        seletor.value = slugCidade(lojaAtiva.cidade || '') || seletor.value;
    }

    const box = document.getElementById('box-lista-lojas');
    box.innerHTML = '';

    (dbLojas[seletor.value] || []).forEach((l) => {
        const isChecked = l.id === lojaTemp.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-full text-left border p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all ${isChecked ? 'border-blue-600 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`;
        btn.setAttribute('aria-pressed', String(isChecked));
        btn.addEventListener('click', () => { lojaTemp = l; renderizarLojasModal(); });
        btn.innerHTML = `
            <div>
                <p class="text-xs font-bold text-gray-900">${esc(l.nome)}</p>
                <p class="text-[10px] text-gray-500">${esc(l.endereco)}</p>
            </div>
            <div class="w-4 h-4 rounded-full border flex items-center justify-center ${isChecked ? 'border-blue-600' : 'border-gray-300'}">
                <div class="w-2 h-2 rounded-full ${isChecked ? 'bg-blue-600' : 'bg-transparent'}"></div>
            </div>`;
        box.appendChild(btn);
    });
}

function salvarEscolhaLoja() {
    lojaAtiva = lojaTemp;
    gravarStorage(localStorage, CHAVE_FILIAL, lojaAtiva.id);
    fecharModalLoja();
    atualizarLayoutFocoLoja();
    executarFiltrosCombinados();

    // Ajusta o carrinho ao estoque da nova filial (sem apagar o que o cliente escolheu).
    if (abaAtual === 'carrinho') renderizarCarrinho();
    if (abaAtual === 'detalhe' && produtoSelecionado) carregarDetalhesProduto(produtoSelecionado.id);
    triggerToast('Filial atualizada', `Retirada em: ${lojaAtiva.nome}`, 'success');
}

function atualizarLayoutFocoLoja() {
    const nomeCurto = lojaAtiva.nome.replace('MegaLoja - Filial ', '');
    const elNav = document.getElementById('nav-loja-nome');
    const elStatus = document.getElementById('txt-status-loja-nome');
    const elDetalheFilial = document.getElementById('detalhe-filial-nome');
    if (elNav) elNav.innerText = nomeCurto;
    if (elStatus) elStatus.innerText = lojaAtiva.nome;
    if (elDetalheFilial) elDetalheFilial.innerText = lojaAtiva.nome;

    if (!produtoSelecionado) return;
    const estoque = estoqueNaFilial(produtoSelecionado);
    const badge = document.getElementById('detalhe-estoque-badge');
    if (badge) {
        if (estoque > 0) {
            badge.className = 'text-[10px] font-bold px-2 py-1 rounded bg-emerald-100 text-emerald-800';
            badge.innerText = `Em estoque (${estoque} un.)`;
        } else {
            badge.className = 'text-[10px] font-bold px-2 py-1 rounded bg-red-100 text-red-800';
            badge.innerText = 'Sem estoque nesta filial';
        }
    }
}

// finalizarCompra() e o restante do checkout ficam em js/checkout.js

// ---------------------------------------------------------------------------
// Meus pedidos
// ---------------------------------------------------------------------------
function guardarPedidosLocais(ids) {
    const atuais = lerStorage(localStorage, CHAVE_PEDIDOS, []);
    const todos = [...new Set([...(Array.isArray(atuais) ? atuais : []), ...ids])];
    gravarStorage(localStorage, CHAVE_PEDIDOS, todos.slice(-50));
}

async function abrirPedidos(pedidosJaCarregados) {
    mudarAba('pedidos');
    await carregarPedidosCliente(true, pedidosJaCarregados);
}

async function abrirMeusPedidos() {
    pedidosNovos = [];
    await abrirPedidos();
}

async function carregarPedidosCliente(mostrarAviso, jaCarregados = []) {
    const mapa = new Map(jaCarregados.map((o) => [o.id, o]));

    try {
        if (sessao && sessao.user.role === 'cliente') {
            const minhas = await apiFetch('/api/orders/mine');
            (minhas.orders || []).forEach((o) => mapa.set(o.id, o));
        }

        const idsLocais = lerStorage(localStorage, CHAVE_PEDIDOS, []);
        const faltando = (Array.isArray(idsLocais) ? idsLocais : []).filter((id) => !mapa.has(id));
        const resultados = await Promise.allSettled(faltando.map((id) => apiFetch(`/api/orders/${id}`)));
        resultados.forEach((r) => {
            if (r.status === 'fulfilled') mapa.set(r.value.order.id, r.value.order);
        });
        // Pedidos já carregados também ganham o status mais recente.
        if (jaCarregados.length > 0) {
            const atualizados = await Promise.allSettled(jaCarregados.map((o) => apiFetch(`/api/orders/${o.id}`)));
            atualizados.forEach((r) => {
                if (r.status === 'fulfilled') mapa.set(r.value.order.id, r.value.order);
            });
        }
    } catch (err) {
        triggerToast('Não foi possível carregar os pedidos', err.message, 'warning');
    }

    const ordenados = [...mapa.values()].sort((a, b) => b.id - a.id);
    const notificacoes = await buscarNotificacoes(ordenados.slice(0, 12));
    renderizarPedidos(ordenados, notificacoes);
    if (mostrarAviso && pedidosNovos.length > 0) {
        const aviso = document.getElementById('aviso-pedido-novo');
        document.getElementById('texto-pedido-novo').textContent =
            pedidosNovos.length === 1
                ? 'Compra finalizada! Seu pedido foi enviado para separação.'
                : `Compra finalizada! Seus ${pedidosNovos.length} itens foram enviados para separação.`;
        aviso.classList.remove('hidden');
    } else if (mostrarAviso) {
        document.getElementById('aviso-pedido-novo').classList.add('hidden');
    }
}

/** S3-10: notificações de cada pedido (o aviso do QR é um mock; o texto avisa isso). */
async function buscarNotificacoes(pedidos) {
    const mapa = new Map();
    const resultados = await Promise.allSettled(pedidos.map((p) => apiFetch(`/api/orders/${p.id}/notifications`)));
    resultados.forEach((r, i) => {
        if (r.status === 'fulfilled') mapa.set(pedidos[i].id, r.value.notifications || []);
    });
    return mapa;
}

function formatarJanela(slot) {
    return `${slot.slice(8, 10)}/${slot.slice(5, 7)} às ${slot.slice(11, 16)}`;
}

function renderizarPedidos(pedidos, notificacoes = new Map()) {
    const lista = document.getElementById('lista-pedidos');
    lista.replaceChildren();
    document.getElementById('pedidos-vazio').classList.toggle('hidden', pedidos.length > 0);

    pedidos.forEach((p) => {
        const st = infoStatus(p.status);
        const entrega = p.delivery_method === 'entrega_padrao';
        const pronto = p.status === 'pronto_retirada';
        const entregue = p.status === 'entregue_cliente' || p.status === 'retirado';
        const cancelado = p.status.startsWith('cancelado');
        const novo = pedidosNovos.includes(p.id);
        const avisos = notificacoes.get(p.id) || [];
        const venceEm = p.reserved_until ? new Date(p.reserved_until + 'Z') : null;

        const card = document.createElement('article');
        card.className = `bg-white rounded-2xl border shadow-sm overflow-hidden ${novo ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-gray-200'}`;
        card.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <div>
                    <h3 class="text-sm font-black text-gray-900">Pedido #${String(p.id).padStart(4, '0')}</h3>
                    <p class="text-[10px] text-gray-500">${esc(new Date(p.created_at + 'Z').toLocaleString('pt-BR'))}</p>
                </div>
                <span class="text-xs font-bold px-3 py-1 rounded-full border ${st.classe}">${esc(st.rotulo)}</span>
            </div>
            <div class="p-5 grid grid-cols-1 sm:grid-cols-3 gap-5 items-center">
                <dl class="sm:col-span-2 text-xs space-y-2">
                    <div class="flex justify-between gap-3"><dt class="text-gray-500">Produto</dt><dd class="font-bold text-gray-800 text-right">${p.quantity}x ${esc(p.product_name)}</dd></div>
                    ${entrega
                        ? `<div class="flex justify-between gap-3"><dt class="text-gray-500">Entrega em</dt><dd class="font-bold text-gray-800 text-right">${esc(p.shipping_address || 'Endereço informado no pedido')}${p.shipping_cost ? ` (frete ${esc(formatarMoeda(p.shipping_cost))} simulado)` : ''}</dd></div>`
                        : `<div class="flex justify-between gap-3"><dt class="text-gray-500">Retirar em</dt><dd class="font-bold text-gray-800 text-right">${esc(p.store_name || 'Filial')}</dd></div>`}
                    ${p.pickup_slot ? `<div class="flex justify-between gap-3"><dt class="text-gray-500">Horário marcado</dt><dd class="font-bold text-blue-700 text-right">${esc(formatarJanela(p.pickup_slot))}</dd></div>` : ''}
                    ${p.origin_store_name ? `<div class="flex justify-between gap-3"><dt class="text-gray-500">Transferência</dt><dd class="font-bold text-gray-800 text-right">de ${esc(p.origin_store_name.replace('MegaLoja - ', ''))} (${Number(p.transfer_eta_days)} dia(s) útil(eis))</dd></div>` : ''}
                    ${p.payment_method ? `<div class="flex justify-between gap-3"><dt class="text-gray-500">Pagamento</dt><dd class="font-bold text-gray-800 text-right">${esc(p.payment_method.replace('+', ' + ').replace('cartao', 'Cartão').replace('pix', 'Pix'))} (simulado)</dd></div>` : ''}
                    <div class="flex justify-between gap-3"><dt class="text-gray-500">Titular</dt><dd class="font-bold text-gray-800 text-right">${esc(p.customer_name)}${p.customer_cpf ? ` (${esc(p.customer_cpf)})` : ''}</dd></div>
                    ${p.third_party_name ? `<div class="flex justify-between gap-3"><dt class="text-gray-500">Retira por você</dt><dd class="font-bold text-blue-700 text-right">${esc(p.third_party_name)} (${esc(p.third_party_cpf || '')})</dd></div>` : ''}
                    ${venceEm ? `<div class="flex justify-between gap-3"><dt class="text-gray-500">Reserva vale até</dt><dd class="font-bold text-amber-700 text-right">${esc(venceEm.toLocaleString('pt-BR'))}</dd></div>` : ''}
                    <p class="text-[11px] text-gray-500 pt-1 border-t border-gray-100">${esc(mensagemStatus(p.status, entrega))}</p>
                    ${avisos.length ? `<details class="text-[11px] text-gray-600"><summary class="cursor-pointer font-bold text-gray-700">Notificações (${avisos.length})</summary><ul class="mt-1.5 space-y-1">${avisos.map((n) => `<li class="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">${esc(n.message)}</li>`).join('')}</ul></details>` : ''}
                </dl>
                ${cancelado || entrega ? '' : `
                <div class="flex flex-col items-center gap-2 ${pronto ? '' : 'opacity-60'}">
                    <div class="w-32 h-32 bg-white border border-gray-200 p-2 rounded-xl relative flex items-center justify-center">
                        ${pronto
                            ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(p.pickup_code || '')}" alt="QR Code de retirada do pedido ${p.id}" class="w-full h-full object-contain">`
                            : `<div class="text-center text-[10px] text-gray-500 leading-tight px-2"><i class="fa-solid ${entregue ? 'fa-circle-check text-emerald-600' : 'fa-lock text-amber-500'} text-lg block mb-1"></i>${entregue ? 'Retirada concluída' : 'Liberado após a separação'}</div>`}
                    </div>
                    ${pronto ? `<span class="text-[11px] font-mono font-bold tracking-wider bg-gray-50 border border-gray-300 rounded-lg px-2 py-1">${esc(p.pickup_code || '')}</span>` : ''}
                </div>`}
            </div>`;
        lista.appendChild(card);
    });
}

function mensagemStatus(status, entrega = false) {
    if (entrega && !status.startsWith('cancelado')) {
        return 'Pedido recebido para entrega em casa. A entrega é simulada nesta demonstração (sem transportadora).';
    }
    switch (status) {
        case 'aguardando_separacao':
        case 'aguardando_preparacao':
            return 'A equipe da filial está separando o seu item. Você verá o QR Code aqui assim que ficar pronto.';
        case 'pronto_retirada':
            return 'Pronto! Vá até a filial com este QR Code e um documento com foto.';
        case 'entregue_cliente':
        case 'retirado':
            return 'Retirada concluída na filial. Obrigado pela compra!';
        case 'cancelado_ruptura':
            return 'O item não estava na prateleira. O pedido foi cancelado e o estorno foi solicitado ao cartão.';
        case 'cancelado_expirado':
            return 'O prazo de retirada terminou. O pedido foi cancelado e o estorno foi solicitado.';
        default:
            return 'Pedido cancelado.';
    }
}

// ---------------------------------------------------------------------------
// Conta do cliente (login e cadastro pelo Supabase Auth, via API)
// ---------------------------------------------------------------------------
function abrirModalAuthCliente(tab = 'login') {
    const modal = document.getElementById('modal-auth-cliente');
    const content = document.getElementById('modal-auth-content');
    alternarTabAuthCliente(tab);
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
        document.getElementById(tab === 'login' ? 'cli-login-email' : 'cli-cad-nome')?.focus();
    }, 15);
}

function fecharModalAuthCliente() {
    const modal = document.getElementById('modal-auth-cliente');
    const content = document.getElementById('modal-auth-content');
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 200);
}

function alternarTabAuthCliente(tab) {
    const tabLogin = document.getElementById('tab-auth-login');
    const tabCadastro = document.getElementById('tab-auth-cadastro');
    const ativo = 'flex-1 py-3 text-center border-b-2 bg-white transition-all flex items-center justify-center gap-1.5';
    const inativo = 'flex-1 py-3 text-center border-b-2 border-transparent text-gray-500 hover:text-gray-800 transition-all flex items-center justify-center gap-1.5';

    document.getElementById('erro-auth-login').classList.add('hidden');
    document.getElementById('erro-auth-cadastro').classList.add('hidden');

    if (tab === 'login') {
        tabLogin.className = `${ativo} border-blue-600 text-blue-600`;
        tabCadastro.className = inativo;
    } else {
        tabCadastro.className = `${ativo} border-emerald-600 text-emerald-600`;
        tabLogin.className = inativo;
    }
    document.getElementById('form-auth-login').classList.toggle('hidden', tab !== 'login');
    document.getElementById('form-auth-cadastro').classList.toggle('hidden', tab === 'login');
}

function mostrarErroAuth(id, mensagem) {
    const el = document.getElementById(id);
    el.textContent = mensagem;
    el.classList.remove('hidden');
}

function iniciarSessao(payload) {
    if (payload.user.role !== 'cliente') {
        throw new Error('Esta é uma conta de colaborador. Use o portal em /operador.');
    }
    sessao = { access_token: payload.access_token, user: payload.user };
    gravarStorage(localStorage, CHAVE_SESSAO, sessao);
    atualizarInterfaceCliente();
}

function encerrarSessaoLocal() {
    sessao = null;
    gravarStorage(localStorage, CHAVE_SESSAO, null);
    atualizarInterfaceCliente();
}

async function executarLoginCliente(event) {
    event.preventDefault();
    const botao = document.getElementById('btn-auth-login');
    botao.disabled = true;
    try {
        const payload = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: document.getElementById('cli-login-email').value.trim(),
                password: document.getElementById('cli-login-senha').value,
                portal: 'cliente',
            }),
        });
        iniciarSessao(payload);
        document.getElementById('cli-login-senha').value = '';
        fecharModalAuthCliente();
        triggerToast('Login concluído', `Bem-vindo, ${sessao.user.name}!`, 'success');
    } catch (err) {
        mostrarErroAuth('erro-auth-login', err.message);
    } finally {
        botao.disabled = false;
    }
}

async function executarCadastroCliente(event) {
    event.preventDefault();
    const senha = document.getElementById('cli-cad-senha').value;
    if (senha !== document.getElementById('cli-cad-senha-conf').value) {
        mostrarErroAuth('erro-auth-cadastro', 'A confirmação de senha não coincide com a senha digitada.');
        return;
    }

    const botao = document.getElementById('btn-auth-cadastro');
    botao.disabled = true;
    try {
        const payload = await apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                name: document.getElementById('cli-cad-nome').value.trim(),
                cpf: document.getElementById('cli-cad-cpf').value.trim(),
                phone: document.getElementById('cli-cad-telefone').value.trim(),
                email: document.getElementById('cli-cad-email').value.trim(),
                password: senha,
            }),
        });
        iniciarSessao(payload);
        document.getElementById('form-auth-cadastro').reset();
        fecharModalAuthCliente();
        triggerToast('Conta criada', `Bem-vindo, ${sessao.user.name}!`, 'success');
    } catch (err) {
        mostrarErroAuth('erro-auth-cadastro', err.message);
    } finally {
        botao.disabled = false;
    }
}

function logoutCliente() {
    encerrarSessaoLocal();
    document.getElementById('chk-nome-cliente').value = '';
    document.getElementById('chk-cpf-cliente').value = '';
    triggerToast('Sessão encerrada', 'Você saiu da sua conta.', 'warning');
    if (abaAtual === 'pedidos') carregarPedidosCliente(false);
}

function atualizarInterfaceCliente() {
    const logado = Boolean(sessao);
    document.getElementById('auth-cliente-deslogado').classList.toggle('hidden', logado);
    document.getElementById('auth-cliente-logado').classList.toggle('hidden', !logado);
    if (!logado) return;

    const { name, email, cpf } = sessao.user;
    document.getElementById('nav-cliente-nome').innerText = (name || '').split(' ')[0] || name;
    document.getElementById('menu-cliente-email').innerText = email || '---';
    document.getElementById('menu-cliente-cpf').innerText = `CPF: ${cpf || '---'}`;
    preencherDadosDoTitular();
}
