# Solicitação de orçamento

## Como usar

- No **PDV** ou em **Orçamentos**, clique em **Solicitar análise**. As duas telas usam o mesmo popup e o mesmo rascunho local.
- Busque um cliente por nome, telefone, e-mail ou CPF/CNPJ e clique em uma sugestão abaixo da busca. Nome, WhatsApp e e-mail serão preenchidos automaticamente. Confira os contatos antes de enviar.
- Para outro cliente, clique em **Preencher manualmente**. Isso limpa o vínculo e os contatos anteriores; enviar a solicitação não cria automaticamente um cadastro de cliente.
- Ao editar manualmente o nome de um cliente selecionado, o vínculo é removido para não associar a solicitação à pessoa errada. Alterar um contato na solicitação não modifica o cadastro original.
- Preencha equipamento, problemas e relato. Identificação, acessórios, estado físico e fotos ajudam a análise. São permitidas até seis fotos JPG, PNG ou WebP, com até 8 MB cada.
- Clique em **Enviar solicitação**. A solicitação é encaminhada para análise; orçamento e OS não são criados automaticamente. Se o envio das fotos falhar, tente novamente no mesmo formulário: a solicitação já salva é reaproveitada.
- Consulte **Acompanhar solicitações** na Central de Orçamentos para acompanhar e analisar os atendimentos.

O **ADM** pode usar **Novo orçamento** diretamente na Central. No PDV, o atalho de mesmo nome abre o editor da Central, sem exigir solicitação. Caixa apenas solicita; técnico mantém o fluxo de análise e criação a partir de solicitação aprovada.

## Comportamento e desempenho

O popup tem quatro blocos: cliente, equipamento, problema e fotos. No celular, ocupa a tela e mantém o rodapé de envio acessível enquanto o conteúdo rola. Fechar preserva o rascunho local, incluindo fotos; Escape fecha e Tab mantém o foco no popup.

PDV e Orçamentos reaproveitam os clientes do carregamento da própria tela. A busca aceita clique/toque ou setas e Enter. Escape fecha as sugestões. Ela filtra localmente até 20 sugestões, sem consulta por tecla. As opções do checklist são obtidas somente na primeira abertura do popup. Não é carregada a lista de 150 solicitações para apenas cadastrar uma nova entrada. A página de acompanhamento continua consultando a lista quando acessada ou atualizada manualmente.

As mudanças estão no projeto local. É necessário publicar os arquivos atualizados e reiniciar o servidor para aplicar o novo endpoint. Nenhum cadastro ou configuração de produção foi alterado durante o desenvolvimento.

Validação: 157 testes automatizados aprovados e 19 cenários de navegador verificados. O cenário mobile detectou um deslocamento transitório na animação; após a correção, os dois cenários do popup foram executados novamente e aprovados. Foram verificados preenchimento de contatos, reaproveitamento de dados sem consultas por tecla, rascunho com fotos, criação da solicitação, análise técnica, geração de OS após aprovação e acesso direto do ADM ao editor. Sintaxe e `git diff --check` sem erros. Todos os testes usaram dados isolados de produção.
