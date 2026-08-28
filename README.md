# Meu Caixa Pessoal — V5

Versão baseada na V4.1, mantendo a estrutura simples e acrescentando somente a função principal combinada: **Compras parceladas**.

## Novidade — Compra parcelada
- Informe o valor total.
- Escolha a quantidade de parcelas (2 a 60).
- Informe a data da primeira parcela.
- Escolha Área e Categoria.
- Adicione uma descrição, por exemplo: `Sofá da sala`.
- O aplicativo cria automaticamente todas as parcelas nos meses corretos.
- Cada movimentação aparece como `Parcela 1/10`, `2/10` etc.
- A tela Resumo possui **Parcelamentos em aberto**, mostrando valor restante e próxima parcela.

## Regra importante do saldo
Parcelas futuras ficam programadas nos meses futuros, mas **não diminuem o saldo atual da tela Início antes da data de vencimento**.

## Histórico mensal
Ao navegar para os próximos meses em Movimentações ou Resumo, as parcelas programadas daquele mês ficam visíveis.

## Backup V5
O backup foi reforçado. Agora exporta:
- movimentações;
- compras parceladas (incluídas nas movimentações);
- recorrentes;
- C. Rotativo;
- áreas, categorias e demais configurações.

Isso corrige uma limitação das versões anteriores, cujo backup não incluía todos esses dados.

## Publicação
Substitua no GitHub os arquivos da raiz:
`index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `README.md`.

Os ícones permanecem os mesmos. O Service Worker foi atualizado para a versão V5 para evitar que o celular mantenha a interface antiga em cache.
