# LYS experimental — MagnetLab 0.4.3

Implementação local de 9 de outubro de 2026.

## Como usar

1. Importe um `.lys` com uma única peça. A unidade do STL não afeta o LYS, interpretado em milímetros.
2. Confira o resumo de escavação, drenagens e suportes.
3. Posicione as cavidades. Em peças ocas, o reforço interno vem habilitado; ajuste parede e fundo em cada cavidade.
4. Confira os cortes e a seção visual.
5. Use **Exportar LYS com suportes** para manter os dados nativos de suporte e base. Use **Exportar STL só da peça** se não precisar desses elementos.
6. Reabra a saída no Lychee e confira contatos dos suportes, fundo dos encaixes, drenagens e posição antes de imprimir.

**O usuário confirmou a abertura da saída 0.4.1 no Lychee.** Essa conferência revelou pontas soltas onde a cavidade removeu a superfície original. A versão 0.4.2 ajusta esses contatos; o arquivo corrigido foi validado geometricamente e por reimportação, mas ainda precisa de conferência visual e fatiamento no Lychee.

## O que é preservado

A saída LYS conserva base, posição, rotação, impressora, resina e estrutura dos suportes. Pontas compatíveis afetadas pelo corte têm seu ponto de contato e comprimento ajustados; os demais registros de suporte permanecem iguais. A prévia do MagnetLab mostra somente a peça, em coordenadas locais; ao reabrir o LYS, o posicionamento original continua registrado na cena.

A escavação, as drenagens e os encaixes passam a fazer parte da geometria. Os respectivos modificadores de escavação e drenagem são desativados/removidos na cópia para impedir aplicação duplicada. Eles deixam de ser editáveis como parâmetros separados nessa cópia. O original não é alterado. A miniatura do projeto é mantida e pode mostrar a peça antes das alterações.

A identidade da nova malha é atualizada para evitar reutilizar uma malha antiga em cache. Os hashes SHA-256 e os offsets do contêiner são recalculados.

## Reconexão dos suportes (0.4.2)

Ao exportar, o MagnetLab compara os contatos com a superfície importada e com a superfície cortada. Se uma ponta antes encostada perdeu contato, procura o novo fundo na direção da normal original. Prolonga a ponta até esse fundo e aumenta seu comprimento na mesma medida, conservando a junção com a haste. O projeto original em memória não é alterado.

O ajuste atual atende pontas cônicas alinhadas à normal (`angle: 100`, sem `isStraight`), com contato original a até 0,02 mm da malha. Junções entre suportes, registros de outro objeto e pontas que já estavam soltas não são reposicionados. Contatos de base só são tratados quando explicitamente definidos como `isBaseTip`.

A primeira superfície encontrada deve ser um fundo novo e alinhado. Um raio que atravessa a drenagem central e encontra a parede original oposta é recusado. Se um contato afetado não puder ser ajustado, a exportação LYS mantém esse contato na posição original e salva os demais ajustes. Um aviso persistente junto ao download mostra a quantidade, os identificadores e o motivo de cada contato pendente. Esses contatos podem continuar soltos e precisam de ajuste manual no Lychee. A verificação considera o eixo da ponta; não avalia toda a espessura do cone, colisões com outros suportes nem resistência para impressão.

Para novas cavidades, importe o LYS original e exporte usando esta versão. Uma saída antiga já contém os cortes incorporados e não guarda a superfície anterior para comparação. O arquivo enviado pelo usuário foi corrigido usando o original como referência. Confira os contatos no Lychee antes de imprimir.

## Reforço interno

O reforço é um volume cilíndrico ao redor e abaixo do alojamento, limitado pelo volume externo original da peça. Todos os reforços são adicionados antes da subtração das cavidades, para que um reforço posterior não preencha um encaixe anterior.

Ao confirmar as cavidades, o processamento compara a região efetivamente removida por cada drenagem com o encaixe e seu reforço. Drenagens que interferem são fechadas por completo, reconstruindo a peça a partir da casca original sem furos. As demais são preservadas.

Cada cavidade de uma peça oca recebe um furo central com raio de 30% do raio final do encaixe (incluindo a folga diametral). Exemplo: encaixe com diâmetro de 12,2 mm gera drenagem de 3,66 mm de diâmetro. O furo atravessa o fundo até o primeiro vazio interno; a saída inteira é conferida para não perfurar a parede oposta. Uma direção sem espaço interno suficiente produz uma mensagem específica.

Mover, excluir ou desfazer uma cavidade recalcula o resultado desde a peça original e restaura as drenagens que deixaram de interferir. A prévia do cilindro é ocultada ao conferir o corte para mostrar o resultado real sem superfícies sobrepostas.

 As medidas de parede e fundo devem ficar entre 0,5 e 10 mm. Em superfícies estreitas ou curvas, a interseção com o contorno original pode reduzir a espessura efetiva. O recurso não verifica toda a espessura final, conexões entre volumes, sucção ou qualidade de impressão.

## Compatibilidade atual

- Contêiner LYS 3.1.0 e malhas binárias versão 2, como no exemplo do Lychee 7.6.4 analisado.
- Um objeto de arquivo, sem escala aplicada na cena.
- Escavação com malha interna armazenada no projeto.
- Até 100 furos cilíndricos, com posição e normal explícitas.
- Sem preenchimento interno, bloqueadores de escavação ou operações booleanas de cena.
- Até 200 MB e 3 milhões de triângulos; esses limites não garantem desempenho.

Variantes não suportadas são recusadas com uma mensagem; não há descarte silencioso desses modificadores.

## Validação

- 49 testes automatizados de geometria, reparo e LYS, incluindo reconexão, preservação das junções, exportação/reimportação e preservação com aviso de contatos sobre drenagens.
- Casos novos: contêiner truncado, conteúdo alterado, entradas sobrepostas, índices inválidos, coordenadas não finitas, recursos não suportados, roundtrip de cena, fundo do reforço, substituição de drenagens, preservação de furos distantes, restauração ao mover/excluir cavidades, novas drenagens proporcionais, proteção da parede oposta e sobreposição de reforços.
- Exemplo real: uma peça oca com seis drenagens e 294 registros de suportes. Uma cavidade com reforço foi exportada e reimportada; a diferença de volume ficou abaixo de 0,000002 mm³. Suportes, base, rotação, escala e posição permaneceram iguais nos dados da cena.
- Navegador: leitura do exemplo, posicionamento por clique, cálculo com reforço e preparação/download LYS concluídos sem erro no console.
- Pendente: comparação visual e fatiamento da saída 0.4.2 com pontas reconectadas no Lychee. Não publicar como compatibilidade completa antes dessa etapa.

## Arquitetura e atribuição

`src/lys.js` lê, valida e escreve o contêiner e a cena MessagePack. As operações geométricas continuam no Worker com Manifold. A nova dependência é `@msgpack/msgpack` 3.1.3. Nenhum serviço de upload é necessário.

A transformação de bytes de compatibilidade foi adaptada do [df-plugin-lys](https://github.com/Open-Resin-Alliance/df-plugin-lys), Open Resin Alliance, licença MIT. O aviso e a licença estão em `public/THIRD-PARTY-LYS.txt` e acompanham a distribuição.

Os testes publicados usam modelos sintéticos. Os arquivos de terceiros usados na validação local não integram o repositório ou o pacote do site.

## Correção 0.4.1 validada com o exemplo real

Uma cavidade final de 12,2 × 3,1 mm na face plana entre duas drenagens fechou os dois furos interferentes e criou um furo central de 3,66 mm. O resultado apresentou malha válida com 50.462 triângulos no teste geométrico. A exportação/reimportação LYS preservou o volume (tolerância 0,001 mm³) e todos os dados de suportes. O mesmo fluxo de substituição foi confirmado pela interface no navegador.


## Correção 0.4.2 validada com o arquivo enviado

Em `Left_Arm-imas (1).lys`, 8 pontas perderam contato ao criar o encaixe. A correção prolongou essas pontas cerca de 3,1 mm, de 3 mm para aproximadamente 6,1 mm. Após exportar e reimportar, os oito contatos ficaram na superfície final e as junções com as hastes conservaram a posição (erros numéricos inferiores a 0,00001 mm). Os demais registros de suporte permaneceram idênticos e o volume da malha permaneceu igual, com tolerância de 0,0001 mm³. Essa validação mede geometria e dados, não substitui o fatiamento no Lychee.

## Exportação com contatos pendentes (0.4.3)

Uma ponta sem reconexão automática não bloqueia mais todo o LYS. A cena exportada combina as pontas reconectadas com os registros originais dos contatos pendentes. O aviso permanece junto ao link de download até uma nova alteração ou exportação. A drenagem permanece aberta: não há tentativa de alongar uma ponta através dela até uma parede distante. Exportar com aviso não significa que todos os suportes foram corrigidos.
