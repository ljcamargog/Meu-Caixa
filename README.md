# Meu Caixa Pessoal — PWA

Esta é a versão para uso pessoal, no mesmo estilo de um app aberto por link no navegador.

## Como funciona
- Abre por um link HTTPS.
- No iPhone: Safari → Compartilhar → Adicionar à Tela de Início.
- Depois abre em tela cheia, como aplicativo.
- Funciona offline depois do primeiro carregamento.
- Lançamentos ficam no próprio aparelho usando IndexedDB.
- Não depende de Expo Go.
- Não depende do computador ligado.
- Não precisa Play Store nem App Store.

## Recursos incluídos
- Pessoal / Trabalho / Sítio / Tudo
- Receita e despesa
- Lançamento Flash
- Transferência entre áreas
- Histórico e busca
- Editar e excluir
- Resumo por categoria
- Lançamentos recorrentes
- Exportar/importar backup em JSON
- Cache offline via Service Worker

## Hospedagem
Envie TODO o conteúdo desta pasta para uma pasta do domínio já usado no outro app.

Exemplo:
https://SEU-DOMINIO/meu-caixa/

Importante:
- O endereço precisa usar HTTPS para o modo offline/PWA funcionar corretamente.
- Os caminhos do projeto são relativos, então ele pode ficar em uma subpasta sem alterações.
- Depois de abrir uma vez com internet, adicione à Tela de Início.

## iPhone
1. Abra o link no Safari.
2. Toque no botão Compartilhar.
3. Toque em "Adicionar à Tela de Início".
4. Confirme "Adicionar".
5. Abra pelo ícone Meu Caixa.

## Dados
Os dados desta versão ficam no navegador/PWA deste aparelho. Apagar os dados do Safari, remover dados do site ou restaurar o iPhone pode apagá-los. Use "Exportar backup" periodicamente.

### Importante sobre a V5 do Expo
Os dados salvos dentro do Expo Go não migram automaticamente para esta versão web, pois são armazenamentos diferentes. Para poucos lançamentos, a forma mais simples é relançá-los. Se necessário, pode ser criada uma exportação específica da V5 Expo para migrar os dados.
