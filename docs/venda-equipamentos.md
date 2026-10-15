# Venda de equipamentos e contratos

Acesse **Venda de equipamentos** no menu comercial (`/equipment-sales`). O módulo usa como referência o arquivo original `InfoCore_Contrato_Equipamento_Usado.html`, preservado na raiz, e oferece variantes para equipamento **novo** e **usado**.

## Uso

1. Registre a venda no PDV para movimentar pagamentos e estoque.
2. Clique em **Novo contrato** (o editor permanece fechado ao entrar na página), escolha novo/usado e, se desejar, importe um cliente cadastrado e vincule uma venda recente. É possível documentar manualmente uma venda anterior, sem vínculo.
3. Confira nome e documento do comprador, endereço, equipamento, série, configuração, condição física, bateria, acessórios, software, valores e recebimentos. O preço é o **valor do equipamento deste contrato**; se a venda do PDV tiver outros produtos, ajuste esse valor.
4. Preencha a data e o local da entrega e registre cada teste como conferido, com ressalva ou não aplicável. Não marque como conferido o que não foi testado. Descreva todas as ressalvas.
5. A garantia obrigatória é sempre gerada para a via do cliente, reutilizando comprador, equipamento, número de série, entrega e contato da loja. A data da entrega pode acompanhar a data do contrato e o local pode acompanhar o endereço da loja, sem redigitação. Informe garantias adicionais somente quando efetivamente oferecidas. Os dados da loja vêm das configurações; se ausentes, o sistema usa os dados do contrato original. Confira-os antes da emissão.
6. Salve o rascunho e use **Prévia PDF** para revisar. O rascunho é identificado como “NÃO ASSINAR”.
7. Clique em **Emitir contrato**. Em seguida, **Abrir PDF / imprimir** abre o leitor do navegador (use o comando de impressão) ou **Baixar PDF** salva o arquivo. Apenas as assinaturas permanecem para preenchimento no papel; os dados do comprador aparecem no corpo do documento, sem nomes ou documentos digitados nas linhas de assinatura. Comprador, representante da loja e testemunha assinam manualmente.

O PDF contém duas vias identificadas: **via do cliente**, com contrato, conferência, assinaturas e folha de garantia; e **via da loja**, com contrato, conferência e assinaturas, sem a folha de garantia. As cláusulas contratuais permanecem iguais nas duas vias. Há três espaços obrigatórios de assinatura, sem dados pré-impressos, também na folha de garantia.

A emissão não declara que houve assinatura nem confirma pagamento. Os valores recebidos devem corresponder aos comprovantes. O contrato não substitui documento fiscal. O vínculo ao PDV nunca cria outra venda, baixa de estoque ou lançamento de caixa.

## Histórico e acesso

Os rascunhos são persistidos no Firestore em `equipment_contracts`. Alterações concorrentes são bloqueadas por revisão. A emissão guarda uma cópia das cláusulas aplicáveis, a versão do modelo e os dados preenchidos. Documentos emitidos não podem ser editados. Uma correção exige outro contrato e o tratamento adequado das vias anteriores; emitir outro não cancela automaticamente o anterior.

Administradores podem consultar todos os contratos; caixas consultam e alteram apenas os próprios. O perfil técnico não acessa este módulo. PDFs exigem sessão e autorização, não são disponibilizados em uploads públicos e usam `Cache-Control: no-store`. O backup integral existente inclui a nova coleção automaticamente.

A lista apresenta até 200 contratos; os seletores oferecem até 300 clientes e 100 vendas recentes. O preenchimento manual continua disponível. A quantidade de páginas do PDF A4 se adapta ao conteúdo, sem limite fixo que corte textos longos.

## Cláusulas e referências

O texto contempla identificação e origem do bem, novo/usado, pagamento e quitação, entrega, vícios aparentes/ocultos, garantia adicional, atendimento, danos posteriores e intervenções, bateria, software/arquivos, contratação remota, dados pessoais e resolução de divergências.

Referências consultadas em 14/10/2026:

- [Código de Defesa do Consumidor — arts. 18, 24–26, 49 e 50](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm).
- [LGPD — finalidade, necessidade, execução contratual e obrigações legais](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html).

Os textos são modelos-base: recomenda-se revisão jurídica da redação e das práticas efetivas da loja antes de uso comercial, especialmente garantias adicionais e vendas à distância.

## Exemplos e validação

Os arquivos em `docs/exemplos-contratos/` são exemplos fictícios, identificados como rascunhos, sem validade comercial:

- `contrato-novo.pdf`
- `contrato-usado.pdf`

Testes específicos: `node --test test/equipment-contract.test.js` e `playwright test test/browser/equipment-contracts.spec.js`. Cobrem validação, concorrência, acesso, emissão imutável, ausência de efeitos financeiros, PDF, persistência do rascunho, modelos novo/usado e larguras móveis.
