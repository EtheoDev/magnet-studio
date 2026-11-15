# Corte anatômico por pintura — MagnetLab 0.6.0

Implementação local de seleção por faces, separação, assentamento e chave mecânica. A especificação de origem está em [MagnetLab-Corte-por-Pintura-Especificacao.md](MagnetLab-Corte-por-Pintura-Especificacao.md).

## Como usar

1. Importe um STL, confira a unidade e repare a malha quando necessário. Escolha **Corte por pintura** no painel esquerdo. **Exemplo de personagem** abre um personagem sintético.
2. Clique na parte desejada. Escolha automático, braço/perna, mão/pé, cabeça ou olho/detalhe pequeno para orientar a proposta. A seleção inicial segue as conexões da malha e inclui o verso. Confira a proposta, ajuste **Menos área ↔ mais área** e confirme em **Usar esta parte**. Arrastar continua girando o modelo. Se precisar, abra **Corrigir com pincel · opcional**, escolha **Pintar** ou **Apagar** e ajuste o raio. No pincel, Alt gira e Shift apaga; ele atinge somente faces visíveis e conectadas ao ponto tocado.
3. Use **Conferir seleção completa**. A borda amarela mostra todos os contornos, inclusive os ocultos. Confira as regiões isoladas e ambiguidades informadas no painel. A suavização tem intensidade, prévia, aceitação e cancelamento. **Ctrl/Cmd Z** e **Ctrl/Cmd Shift Z** usam o histórico da pintura enquanto essa ferramenta está aberta.
4. Defina largura da faixa, profundidade, refinamento e direção de saída da região pintada. **Usar direção da câmera** é um ponto de partida. Inverta o ressalto quando necessário. **Preparar peças** constrói os dois sólidos e verifica a passagem na direção escolhida. A faixa interna nova aparece em laranja; os vértices externos originais ficam preservados.
5. Escolha pino redondo, chave retangular ou entrada afunilada. Posicione na área plana de apoio, revelada pelas peças afastadas. Ajuste posição e rotação pelos controles de movimento, pelos anéis de rotação ou pelos campos numéricos. Escolha a peça que recebe o macho. **Aplicar e verificar chave** recalcula a geometria a partir do assentamento, sem acumular chaves anteriores.
6. Confira **Região original**, **Peças separadas** e **Montagem**. Leia o relatório. Exporte a região pintada e o restante pelos botões STL próprios. O afastamento da prévia não aparece nos arquivos; a unidade e as coordenadas de montagem são preservadas.

O corte por pintura usa a malha importada ou reparada. As cavidades para ímãs têm edição e exportação próprias. Para separar outros membros, reimporte o STL do restante e repita o fluxo. Seleções e parâmetros ainda não são salvos entre sessões.

## Medidas e folgas

- **Lateral por lado:** distância em milímetros adicionada a cada lado do alojamento. Um pino de 4 mm com 0,20 mm por lado recebe alojamento de 4,40 mm.
- **Fundo:** comprimento adicional do alojamento, em milímetros.
- **Assentamento:** deslocamento axial da superfície complementar na área plana de apoio. Na faixa de transição, a folga cresce suavemente a partir de zero na borda externa, preservando essa borda.
- **Parede mínima:** margem ao redor e no fundo do alojamento. São verificados o envelope original e o material disponível na peça fêmea; a base da chave deve permanecer dentro do macho.
- **Entrada afunilada:** a expansão lateral considera a inclinação da parede para manter a distância normal especificada. A chave inteira não é escalada percentualmente para criar a folga.

Os perfis iniciais de resina e filamento são editáveis e exigem calibração física. A verificação geométrica não mede contração, deformação ou precisão da impressora. Superfícies curvas e pinos redondos são aproximações trianguladas.

## Fechamento e preservação

A seleção por clique usa distâncias pela superfície e procura estreitamentos nas conexões e nas seções da parte. Uma cabeça arredondada pode ser selecionada pelo pescoço sem precisar pintar sua parte de trás. Componentes independentes, como um olho separado, são selecionadas por inteiro. Os tipos de parte orientam a sugestão de alcance; não são um reconhecimento anatômico por inteligência artificial. Em malhas contínuas sem um estreitamento claro, ajuste a proposta e retoque a borda. A confirmação substitui a seleção anterior e pode ser desfeita como uma única ação.

A seleção usa IDs das faces do índice instalado depois da construção da BVH. A vizinhança topológica é construída em arrays compactos. Uma pincelada guarda apenas os IDs das faces que mudaram; desfazer altera a máscara e os índices da sobreposição, sem reconstruir o modelo.

O Worker extrai os contornos entre faces selecionadas e não selecionadas. Para cada abertura, projeta o contorno na direção de montagem, gera faixas internas por offsets e triangula os anéis com furos. A triangulação da área de apoio respeita concavidades. Contornos não planos recebem interpolação de altura e refinamento apenas na faixa nova.

As duas tampas derivam dessa mesma referência. Com folga de assentamento zero, usam a mesma superfície com orientações opostas. Com folga positiva, a superfície complementar deriva da referência deslocada. Nenhum vértice original é suavizado ou movido. A suavização da seleção altera quais faces pertencem à região, com prévia explícita.

Manifold valida os sólidos fechados e orientados, as componentes, o volume de interseção e a permanência dentro do envelope original. A chave é unida ao macho e seu alojamento é subtraído da fêmea.

## Passagem de montagem

A verificação usa colisão contínua entre triângulos sob translação, com BVH para reduzir candidatos. Verifica o movimento completo desde a montagem até uma distância que separa as projeções das duas peças. O percurso inverso representa a inserção. Como os sólidos começam sem interseção, apenas faces que avançam para dentro da outra peça podem iniciar uma colisão; as tampas que se afastam são descartadas dessa busca.

O relatório distingue passagem **livre**, **bloqueada** e **inconclusiva**. Colisão ou limite de trabalho impedem exportação. A tolerância geométrica da busca é 0,000001 mm, com exclusão de contato inicial dentro de uma margem numérica. A verificação cobre translação na direção escolhida; trajetórias que exigem girar, deformar ou manobrar a peça durante a inserção não são calculadas.

## Limites explícitos

- As duas regiões precisam ser conectadas e não podem conter ilhas. Fronteiras abertas ou ambíguas são rejeitadas.
- São aceitas várias aberturas com projeções separadas, como duas colunas de um arco. Aberturas aninhadas, sobrepostas ou contornos que dobram sobre si na direção escolhida precisam de outra seleção ou direção.
- Cada contorno tem limite de 12 mil arestas para a validação de cruzamentos. A verificação de passagem tem orçamento de 5 milhões de pares de triângulos e informa quando fica inconclusiva.
- Offsets que eliminam a área de apoio ou criam ilhas, transições que cruzam o exterior, chaves fora da área de apoio e paredes insuficientes são rejeitados.
- Uma chave é aplicada por separação. A posição e a rotação são livres, mas o resultado precisa passar pelas verificações geométricas.
- O corte de um LYS exporta apenas duas peças STL. Redistribuição de suportes e saída LYS para esse fluxo continuam fora do escopo, conforme a especificação.
- Os ensaios são sintéticos. Eles não comprovam equivalência completa ao trabalho manual da referência em qualquer personagem, nem certificam a fabricação.

## Validação e desempenho

Os testes em `tests/paint.test.js` e `tests/paint-brush.test.js` cobrem pincel com superfícies próximas e conectadas pelo ombro, ocultação, histórico compacto, ilhas, contornos planos e não planos, uma fronteira com variação de 12 mm, várias aberturas, preservação externa, três formas de chave com inversão do macho, folgas, paredes, obstáculos durante o percurso e exportação/reimportação com coordenadas preservadas.

Resultados em Node.js v24.15.0, macOS ARM64, em 14/10/2026, com esfera de **2.097.152 triângulos**:

| Operação | Tempo observado |
|---|---:|
| Construir BVH | 559 ms |
| Construir vizinhança | 264 ms |
| Pincel com BVH, visibilidade e distância pela superfície, 968 faces | 9 ms |
| Registrar pincelada de mil faces | 0,29 ms |
| Desfazer / refazer | 0,10 / 0,10 ms |
| Extrair contorno de 2.048 arestas | 41 ms |
| Prévia de suavização, duas iterações | 28 ms |
| Separar, validar e conferir passagem | 22,14 s |
| Aplicar chave e conferir passagem | 3,03 s |
| Exportar uma peça | 0,58 s |
| Reimportar e validar | 1,78 s |

O histórico de mil faces ocupou 4.000 bytes. O processo de seleção atingiu aproximadamente **1,32 GB de RSS**. O ensaio completo de sólidos atingiu aproximadamente **2,72 GB de RSS**. A separação e a chave tiveram passagem livre, interseção zero e uma componente por peça. A peça reimportada apresentou `NoError`, com diferença de volume de aproximadamente 0,000075 mm³.

Esses números vêm de duas execuções sintéticas no mesmo host; não incluem toda a memória da interface/GPU nem são uma garantia de capacidade no navegador. Os dados completos estão em `tests/paint-benchmark-result.json` e `tests/paint-solid-benchmark-result.json`.

As medições acima são do fluxo original de pincel e sólidos. A seleção inicial por clique foi acrescentada depois e tem testes próprios em `tests/part-selection.test.js`; sua busca de região não está incluída nesses tempos.

```sh
npm test
npm run benchmark:paint
npm run benchmark:paint-solid
npm run build
```
