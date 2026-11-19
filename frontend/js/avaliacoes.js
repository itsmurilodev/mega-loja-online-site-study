function renderAvaliacoes(avaliacoes) {
    const lista = document.getElementById("lista-avaliacoes");
    const media = document.getElementById("media-avaliacoes");
    lista.replaceChildren();
    const soma = avaliacoes.reduce((acc, a) => acc + a.nota, 0);
    media.textContent = avaliacoes.length
        ? `${(soma / avaliacoes.length).toFixed(1)} ★ (${avaliacoes.length} avaliações)`
        : "Ainda sem avaliações";
    for (const a of avaliacoes) {
        const li = document.createElement("li");
        li.textContent = `${"★".repeat(a.nota)} ${a.autor}: ${a.comentario}`;
        if (a.fotoUrl) {
            const img = document.createElement("img");
            img.src = a.fotoUrl;
            img.alt = "Foto da avaliação";
            li.append(img);
        }
        lista.append(li);
    }
}
// DADOS DE TESTE: apagar quando o back do Léo estiver pronto
const avaliacoesMock = [
    { nota: 5, comentario: "Chegou rápido, produto ótimo.", autor: "Maria" },
    { nota: 4, comentario: "Bom, mas a embalagem veio amassada.", autor: "Carlos" },
];
document.addEventListener("DOMContentLoaded", () => {
    renderAvaliacoes(avaliacoesMock);
});
