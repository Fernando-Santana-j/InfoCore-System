# Consulta do PDV sem internet

Abra `/pdv` com internet por HTTPS (ou localhost) e aguarde “PDV disponível offline neste navegador”. Depois, o mesmo endereço pode ser reaberto ou atualizado sem internet, no mesmo navegador e perfil. Pesquisa, filtros, códigos e cálculos do carrinho usam os produtos e preços salvos na última preparação bem-sucedida.

O aviso mostra a data da cópia. Preços e estoque podem estar desatualizados. Ao recuperar a conexão, recarregue o PDV para atualizar. Finalização de vendas, orçamentos, solicitações e demais registros continuam dependendo do servidor; não há fila de vendas offline. Outras páginas e sites externos não são disponibilizados offline.

A cópia é específica deste navegador e contém a página do usuário autenticado, configurações e catálogo permitido a ele. A lista de clientes não é armazenada no bootstrap offline. Acesso ao login, tentativa de logout e resposta de autenticação recusada do PDV apagam a cópia. Limpar os dados do navegador também a remove. Sem uma preparação anterior, não é possível abrir o PDV offline. HTTP em um endereço de rede não permite service workers: use HTTPS.
