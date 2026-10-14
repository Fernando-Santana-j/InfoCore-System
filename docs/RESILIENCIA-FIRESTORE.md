# Indisponibilidade do Firestore

`RESOURCE_EXHAUSTED` (código 8) indica que uma operação foi recusada por limite de recursos/cota. O log antigo “Erro não tratado” vinha do middleware do Express; ele não comprova, sozinho, uma queda do processo.

## Comportamento da proteção

- Sessões, consultas do módulo de dados e tratadores compartilhados reconhecem cota, indisponibilidade e tempo excedido do banco.
- A resposta é HTTP **503**, com mensagem de indisponibilidade e `Retry-After`.
- Após detectar a falha, novas requisições dinâmicas ficam pausadas por **60 segundos**. Depois, uma única requisição verifica a recuperação. Se falhar, a pausa continua.
- Cada processo tem seu próprio estado de proteção; ele não coordena vários servidores.
- Não há repetição automática de vendas, pagamentos ou gravações. Confira o resultado antes de repetir: um erro pode acontecer depois de alguma etapa já ter sido concluída.
- Falhas de consulta não são convertidas em listas vazias ou “usuário não encontrado”. Sessões sem validação válida não ganham acesso durante a indisponibilidade.
- Leituras simultâneas da mesma sessão são agrupadas. Uma leitura antiga não repovoa o cache de coleções após uma atualização.
- Falhas nos eventos assíncronos de conexão e gravação de credenciais do WhatsApp são capturadas localmente e registradas.
- Arquivos estáticos continuam disponíveis sem consultar sessão ou banco. Logs tratados de indisponibilidade são resumidos e limitados por intervalo; outras falhas continuam registradas.

## Diagnóstico

`/health/live` verifica se o servidor responde, sem acessar Firestore. `/health/ready` informa a última indisponibilidade conhecida pelo processo: não executa uma consulta de teste nem garante sucesso da próxima operação.

Consulte **Firestore → Uso** no Firebase e as cotas no Google Cloud para identificar qual limite foi atingido. A proteção não aumenta a cota nem cria funcionamento offline. Limites diários exigem aguardar renovação ou ajustar capacidade/faturamento conforme o projeto. Não foi identificado o limite específico da conta a partir do log fornecido.

Referências oficiais: [uso e limites](https://firebase.google.com/docs/firestore/quotas) e [tratamento de erros no Express 5](https://expressjs.com/en/guide/error-handling.html).

## Aplicar no servidor Windows

Publique os arquivos atualizados e reinicie a aplicação pelo PM2. Se `pm2 list` confirmar o nome `infocore` apresentado no log, use:

```text
pm2 restart infocore --update-env
```

Para aplicar também `ecosystem.config.js`, faça o campo `name` corresponder à aplicação existente antes de usar o arquivo. O nome atual no repositório é `infocoreSystem`; usar outro nome pode iniciar uma segunda instância.

O arquivo explicita reinício automático e espera progressiva para falhas fatais, limitando ciclos de inicialização com erro. É recuperação supervisionada, não garantia de ausência absoluta de quedas. Não foi adicionado um capturador global que ignore exceções fatais e continue em estado potencialmente inconsistente.

Nenhuma publicação, reinicialização remota ou alteração de cota/faturamento foi realizada nesta correção.

## Validação

Checagem de sintaxe e **142 testes automatizados aprovados**, incluindo servidor HTTP com cota simulada, recuperação, sessão, cache e falha de gravação. Os testes não usam credenciais nem operações de produção.

## Redução de leituras e contingência local (13/10/2026)

### Causa encontrada no código

Orçamentos e Links de propostas consultavam coleções inteiras a cada 10 segundos, mas o cache expirava em 8 segundos. Com 100 documentos, uma única tela aberta podia provocar aproximadamente 36 mil leituras de documentos em uma hora, além das demais operações. Isso é uma estimativa do comportamento encontrado; o histórico exato deve ser conferido no Firebase.

A cota gratuita de 50 mil leituras se renova diariamente por volta da meia-noite no horário do Pacífico. Em Maceió isso corresponde aproximadamente às 4h durante o horário de verão do Pacífico (como em outubro de 2026) e às 5h fora dele. Não são 24 horas após o momento do bloqueio. A proteção de 60 segundos da aplicação não renova a cota do provedor.

Referências: [cotas](https://firebase.google.com/docs/firestore/quotas) e [contagem/cobrança de leituras](https://firebase.google.com/docs/firestore/pricing).

### Alterações

- Removida a consulta periódica de Orçamentos e Links de propostas. Use **Atualizar lista** para buscar respostas recentes do cliente ou mudanças feitas em outra sessão.
- Cache de coleções ampliado de 8 segundos para **5 minutos**. A variável `DATA_CACHE_TTL_MS`, se configurada no servidor, prevalece: confira se não está em `0` ou `8000`.
- Atualizações manuais dessas listas podem renovar o cache; cliques repetidos em menos de 5 segundos reaproveitam a leitura. Consultas simultâneas compartilham o mesmo resultado.
- Mutações invalidam as coleções relacionadas, sem apagar indiscriminadamente todos os caches.
- PDV não carrega mais a coleção de orçamentos nem modelos de serviço sem necessidade.
- Leitura do catálogo não executa mais correção automática de SKUs; cadastros novos continuam usando suas validações de código. Dados legados devem ser corrigidos pelo fluxo de manutenção, não ao abrir cada tela.
- Cache de configuração: 5 minutos. Cache de sessão validada: 2 minutos. Sessões sem validação não são liberadas durante falha do banco.
- Em **Configurações → Uso local de leituras do banco**, o ADM pode consultar chamadas, documentos retornados, usos de cache, consultas agrupadas e falhas. São contadores do processo para leituras de coleções via models, não a medição oficial do Firebase. Excluem sessões, leituras diretas, transações e outros processos; reiniciar zera os contadores.

O cache não é compartilhado entre servidores/processos. Mudanças externas podem levar até 5 minutos para aparecer nas listas em cache. As transações de venda continuam consultando o banco para validar o estoque. Não foi criada venda offline.

### Consulta durante indisponibilidade

Após leituras bem-sucedidas, a plataforma salva automaticamente cópias em **`data/contingency/`**, fora das pastas públicas. Não faz consultas adicionais ao Firestore para gerar essas cópias. São preservados o arquivo mais recente e a primeira cópia de cada um dos últimos sete dias com captura, por coleção.

As cópias cobrem dados já consultados de produtos, clientes, orçamentos, vendas, fluxo de caixa, OS e modelos/propostas. Solicitações são copiadas quando a lista é consultada e cobrem até as últimas 150. Credenciais, usuários e sessões são excluídos. Cada arquivo tem data e checksum verificável.

No computador do servidor, abra o terminal na pasta do projeto e execute:

```text
node scripts/contingency.js
```

O comando funciona sem Firebase e gera **`data/contingency/consulta-offline.html`**. Abra esse arquivo no navegador para pesquisar cliente, código, produto ou descrição e expandir os registros. A página é somente leitura, não faz chamadas de rede e informa as datas e coleções faltantes.

**Limites:** essa cópia é parcial, não substitui um backup integral e pode estar desatualizada. Ela só começa a existir depois de instalar esta versão e consultar dados com sucesso. Se a cota já estiver bloqueada e não houver cópia anterior, não é possível recuperar dados que nunca foram copiados. Anexos não são embutidos no HTML. O comando se recusa a gerar um relatório quando nenhuma cópia válida está disponível.

Guarde `data/contingency/` em local privado e copie-a periodicamente para outro disco seguro. Ela contém dados pessoais e internos. Uma cópia apenas no disco do servidor não protege contra perda desse disco. Inclua também `uploads/` e `private-uploads/` no backup de arquivos.

### Backup integral complementar

Quando o Firestore estiver disponível, o exportador já existente pode produzir um backup integral dos documentos e subcoleções:

```text
node scripts/backup.js export backups/infocore-AAAA-MM-DD.json
node scripts/backup.js verify backups/infocore-AAAA-MM-DD.json
```

Crie a pasta `backups` previamente e use um nome novo por exportação. Esse exportador consome leituras; não o execute repetidamente nem durante esgotamento de cota. A restauração fornecida pelo script é restrita ao emulador, para validação. Nenhuma restauração sobre produção é feita automaticamente.

Validação da otimização: 148 testes automatizados, incluindo simulação de consultas a cada 10 segundos durante cinco minutos (uma única leitura remota da coleção), invalidação, cópias locais, falha de disco, checksum e relatório offline. Nenhum dado de produção foi exportado nesta sessão.


## Revisão adicional de leituras, gravações e memória (14/10/2026)

- Links públicos de orçamento, seleção e OS carregam por requisição. Não há tarefa de pré-carregamento desses links. As rotas públicas reconhecidas dispensam consultas e renovações da sessão administrativa, mesmo quando abertas pelo lojista autenticado. As rotas internas continuam protegidas.
- Quando a resposta já está incorporada no orçamento/seleção, ela é reaproveitada: a página não consulta novamente o documento de resposta. Links antigos sem essa informação mantêm a consulta de compatibilidade. O token e as permissões continuam sendo consultados no banco, para não servir acesso revogado a partir de cache.
- Respostas novas gravam os dois documentos em um lote atômico e retornam o conteúdo após a confirmação, sem reler o documento. Isso reduz uma leitura por salvamento; o lote ainda cobra duas gravações. Datas dessa resposta são geradas pelo relógio do servidor da aplicação.
- Reenvio sequencial de uma resposta idêntica não grava documentos nem invalida os caches. Requisições simultâneas podem ainda gravar, pois essa comparação não substitui uma transação de concorrência. Vendas e pagamentos mantêm suas próprias proteções transacionais.
- Edições no link aguardam 3 segundos sem novas alterações antes de salvar, agrupando digitação e cliques rápidos. Finalizar continua salvando imediatamente. O rascunho local e a tentativa de salvar ao sair da página são preservados; fechar o navegador não garante entrega de rede.
- Sessões com “lembrar de mim” não gravam uma renovação de expiração inexistente. Login, logout e alterações de sessão continuam persistindo normalmente.
- Cache de coleções limitado a 24 entradas e estimativa de **16 MiB de conteúdo serializado UTF-16**, com descarte das menos usadas. Configure `DATA_CACHE_MAX_BYTES` com um número positivo para ajustar. Coleções maiores continuam sendo retornadas, mas não são retidas nesse cache. Entradas expiradas são removidas no próximo acesso/consulta aos contadores, sem temporizador consultando o banco. O limite não equivale ao consumo total de RAM do Node, que também inclui requisições, anexos, sessões e cópias locais.

A redução exata em produção depende da quantidade de documentos, visitantes e processos PM2. Não se deve remover validações de estoque, autorização ou confirmação de pagamento para reduzir leituras. Após publicar, compare o painel oficial do Firebase em dias completos equivalentes; os testes locais não substituem essa medição.

Validação desta revisão: **155 testes aprovados**, checagem de sintaxe e `git diff --check` sem erros. Inclui economia de leituras por resposta incorporada, repetição sem gravação, erro de lote, isolamento das rotas públicas, limites/expiração do cache e sessão persistente sem renovação inútil. Testes executados com dados simulados, sem consultar o Firebase de produção. Não houve publicação nem reinício do servidor remoto.
