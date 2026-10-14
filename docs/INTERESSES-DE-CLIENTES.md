# Produtos procurados pelos clientes

1. Abra **Clientes CRM**, selecione o cliente e clique em **Registrar interesse**. Se ele ainda não estiver cadastrado, use **Novo cliente** primeiro.
2. Informe o produto, preferências e, opcionalmente, quanto pretende gastar. Exemplo: “Notebook para estudar”, “16 GB, pode ser usado”, até R$ 2.000.
3. Quando houver uma opção disponível, procure “notebook” em **Produtos procurados**. A busca também encontra nome, telefone e detalhes, sem consultar o Firebase a cada tecla.
4. Clique em **Abrir WhatsApp** para revisar e enviar a mensagem. Abrir o WhatsApp não envia automaticamente nem marca o cliente como avisado. Confirme **Cliente avisado** em **Editar / atualizar etapa** depois do contato.
5. Marque **Atendido** ou **Cancelado** para retirar o interesse da lista de pendentes. Consulte o histórico pelo filtro de etapa ou por **Todos**.

O interesse fica associado ao cliente e continua disponível após recarregar. É separado das solicitações técnicas de orçamento e das requisições antigas do CRM. Excluir o cadastro do cliente também exclui seus interesses. São aceitos até 100 registros por cliente, com título de até 120 caracteres e detalhes de até 1.000 caracteres.

O painel reaproveita os clientes já carregados. Para consultar mudanças feitas em outra sessão, use **Atualizar**. A atualização manual renova o cache de clientes, respeitando a proteção contra cliques repetidos. Não há monitoramento automático do estoque nem disparo de mensagens em segundo plano.

As gravações usam transação no documento do cliente para preservar outros interesses criados simultaneamente. Repetir o mesmo envio após uma resposta perdida não cria duplicata. A lista retornada pela gravação atualiza a tela sem uma nova leitura de toda a coleção nem consulta de vendas.

Validação local: 160 testes automatizados aprovados, checagem de sintaxe e dois cenários de navegador aprovados, incluindo layout mobile, persistência após recarregar, busca local, link do WhatsApp e preservação do histórico. Nenhum cliente real foi alterado e nenhuma mensagem foi enviada. As alterações precisam ser publicadas no servidor para uso em produção.
