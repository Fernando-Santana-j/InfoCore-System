# Consulta sem internet

Abra o sistema com internet por HTTPS (ou localhost). Qualquer página autenticada prepara automaticamente o menu, o PDV e os orçamentos permitidos ao usuário. No PDV, o aviso fica recolhido no rodapé em “Consulta offline”; nos orçamentos, o aviso informa a data da cópia. Aguarde a preparação antes de desconectar.

No mesmo navegador e perfil, é possível reabrir `/pdv` e `/budgets`, inclusive atualizar a página. O PDV permite pesquisar produtos, consultar preços e calcular o carrinho. Orçamentos permite pesquisar a lista e visualizar cliente, opções, itens, valores, prazo, garantia e observações em uma apresentação local. A consulta não depende da geração de modelos pelo servidor.

As demais páginas do sistema mostram “Você está offline” e mantêm o menu permitido ao usuário, mesmo quando o endereço ainda não foi visitado. O menu funciona também em telas pequenas. Se a rede cair com uma dessas páginas aberta, seu conteúdo é substituído pelo aviso. Sites externos e páginas públicas não fazem parte deste recurso.

Os dados refletem a última preparação bem-sucedida e podem estar desatualizados. Reconecte e recarregue a página para atualizar. Alterar orçamentos, finalizar vendas, compartilhar links e outros registros exigem conexão; não há fila de gravações offline. A visualização local de orçamentos prioriza informações textuais e valores, sem depender de imagens externas.

A cópia contém o menu do usuário autenticado, configurações, catálogo e orçamentos autorizados. Não é armazenada a lista completa de clientes nos dados offline, mas os orçamentos preservam os dados de seus clientes. Login, tentativa de logout, recusa de autenticação e troca de identidade na preparação removem os dados anteriores. Limpar os dados do navegador também remove a cópia.

Sem preparação anterior, não há consulta offline. HTTP em endereço de rede não permite service workers: use HTTPS.
