# Estúdio de separação

Importe um 3MF com cores padrão ou pintura de Bambu Studio, OrcaSlicer e PrusaSlicer. As cores aparecem no modelo e na lista à esquerda. A pintura compactada é subdividida em faces de uma única cor, preservando os limites pintados; a malha também recebe os pontos necessários nos triângulos vizinhos para evitar aberturas. Clique na lista para selecionar todo um filamento, ou no modelo para selecionar apenas sua região conectada (opção configurável). Combine cores clicando em mais de uma região. A seleção mantém uma ação de desfazer por clique.

Use laço para selecionar uma área projetada, incluindo o verso ou somente faces visíveis. Shift adiciona ao laço anterior. Pincel, apagar e borda permitem retoques; a ferramenta de borda só modifica faces junto à fronteira atual. Para modelos sem cores, há também sugestões pela geometria.

**Pincel Suavizar (S):** passe sobre o limite da seleção para reduzir o serrilhado mantendo curvas orgânicas. O pincel filtra os valores de seleção ao longo das arestas da superfície, com compensação de encolhimento e transição suave no limite do raio. Ele não ajusta uma reta nem desloca vértices do modelo. Raio e força controlam o alcance e a intensidade. A área verde pode preencher frações dos triângulos; o corte usa essa mesma seleção contínua.

Cada passada pode ser desfeita/refeita por Ctrl/Cmd Z. Projetos `.magnetlab` preservam os ajustes contínuos da borda. Ao usar Suavizar, o fechamento simples é ativado e a suavização global por raio é desligada, preservando o ajuste local do pincel. Uma nova seleção por cor ou laço substitui esses ajustes; Desfazer recupera o estado anterior.

A seleção contínua divide os triângulos na superfície original antes do fechamento. A prévia da borda usa esses segmentos em 3D, sem reprojetá-los sobre outras partes. O corte por pincel não usa a união de projeções 2D. Após as operações booleanas, folhas residuais com espessura abaixo da precisão das coordenadas e volume desprezível são descartadas; componentes físicos são preservados.

O fechamento padrão **Separar parte pela borda selecionada** compartilha a mesma tampa entre as duas partes e mantém a costura na seleção, sem extrudar uma parede de profundidade. Uma borda com centro visível em toda a sua projeção recebe uma tampa em leque com centro interno; outros contornos usam triangulação. O resultado é verificado contra sobreposição e material fora do modelo. Para pinturas planas que precisam remover uma camada com espessura, escolha **Recorte com profundidade**. A verificação de montagem pode indicar bloqueio numa costura orgânica, mesmo que as peças estejam fechadas.

**Separar seleção** usa o comando dedicado `cutSelection`: recebe somente máscara, ajuste contínuo e direção. Configurações de profundidade, arredondamento global e assentamento de projetos antigos não modificam esse comando. Ele não corrige faces da seleção silenciosamente. Recortes com espessura e ressaltos ficam em **Recorte e assentamento avançados**, aplicados por um botão separado. A área verde é construída com `selectionSurface`, a mesma divisão de triângulos usada no worker, incluindo as transições entre valores finitos e vértices sem ajuste. Todos os métodos avançados também compilam esse campo antes de fechar a malha.

Para conferir visualmente a cabeça suavizada do exemplo, execute `npm run dev` e abra `/tests/visual-paint-head.html`. A página renderiza seleção e resultado lado a lado usando o worker real. O teste automatizado do worker compara cada face da superfície com o lado correspondente do resultado e verifica que a cabeça não ganha material abaixo da seleção, mesmo recebendo opções antigas de profundidade/assentamento.

Separe a seleção com o botão sobre a área 3D ou Espaço. Objetos já independentes são extraídos sem criar tampas. Para regiões de uma superfície contínua, confira o contorno e a direção de saída; o fechamento e o assentamento exigem uma fronteira válida e podem recusar regiões incompatíveis. Selecionar uma cor não garante que qualquer fronteira possa ser fechada automaticamente.

O fechamento simples extrai uma região com profundidade interna configurável e calcula o restante por subtração da mesma geometria. Ele não utiliza a faixa de assentamento. A direção automática considera a superfície selecionada; use “direção da câmera” ou os campos para controlá-la manualmente. Encaixes com ressalto continuam no modo de assentamento.

A suavização geométrica do fechamento simples fica ligada por padrão (raio de 0,35 mm). A linha amarela mostra o contorno suavizado projetado na superfície. O corte usa essa mesma curva e pode atravessar os triângulos originais, eliminando o serrilhado do contorno baseado em faces. Aumente o raio para arredondar mais; detalhes menores podem desaparecer. Desative a opção para preservar o limite exato das faces pintadas. O ajuste antigo de seleção por triângulos é opcional e separado dessa suavização.

Encontros de regiões num único vértice são resolvidos pela união e regularização dos polígonos projetados, sem exigir retoque manual. A peça é a interseção do modelo com uma extrusão desse contorno, e o restante é a diferença da mesma geometria. A passagem na direção da extrusão é livre por construção; o relatório identifica esse método como `extruded-contour`. Outros modos continuam usando o teste contínuo de colisão. Cascas de volume numericamente nulo (até 10⁻¹² mm³) são eliminadas; componentes físicos pequenos são mantidos.

A correção de microfragmentos, ativada por padrão e reversível com Desfazer, ajusta triângulos isolados cuja área é menor que 0,1% da área selecionada. Há limites de alterações por operação; regiões relevantes não são descartadas. A suavização também elimina esses microfragmentos na prévia. O diagnóstico distingue arestas realmente abertas de encontros ambíguos na seleção de uma malha fechada.

A verificação de passagem usa tolerância proporcional à precisão Float32 das coordenadas, evitando que paredes que apenas deslizam em contato sejam tratadas como colisão numérica. Colisões reais continuam bloqueando a exportação.

O plano permite eixo, posição, inclinação e inversão. Ele corta o sólido e fecha as duas metades. O painel de encaixes permite chaves e folgas quando existe uma superfície de contato compatível. Inspecione a montagem ou a prévia separada antes de exportar.

Baixe os STLs separadamente ou em um ZIP com o relatório. STL não armazena cores. Salvar projeto gera um `.magnetlab` com geometria original, paleta, seleção e configurações; reabra pelo mesmo importador. O projeto não salva o resultado booleano pronto: regenere a separação e o encaixe ao reabrir.

## Compatibilidade

- 3MF: cores/materiais padrão por face, transformações dos objetos e unidades do modelo; processamento local. Limite de 250 MB compactado e 512 MB descompactado.
- Pintura compactada: `paint_color` (Bambu Studio / OrcaSlicer) e `slic3rpe:mmu_segmentation` (PrusaSlicer), incluindo árvores de subdivisão, filamentos estendidos e regiões sem pintura que herdam o filamento do objeto/parte. A paleta vem das configurações JSON ou INI do projeto; sem essas configurações são usadas cores de identificação e os números dos filamentos são preservados.
- Projetos Bambu com objetos em arquivos `.model` externos preservam referências de componentes e transformações. Limite de 3 milhões de faces após subdivisão e 24 níveis de pintura por triângulo. Fluxos inválidos ou truncados são recusados.
- Texturas e gradientes dentro de faces do 3MF padrão continuam fora do fluxo de seleção por cor. Esse importador não aplica modificadores de fatiamento, alturas de camada ou configurações de impressão à geometria.
- OBJ: malha, cores por vértice uniformes por face e grupos; arquivos MTL externos não são carregados.
- STL e LYS: fluxos existentes preservados. STL não contém cores nativas.

Atalhos: 1 região, 2 laço, 3 plano, 4 pincel, 5 apagar, B borda, Esc girar, Espaço separar e Ctrl/Cmd Z desfazer. Todos os arquivos são processados neste dispositivo.

O formato de subdivisão foi conferido com `TriangleSelector::serialize`, `deserialize` e `perform_split` no [código oficial do Bambu Studio](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/TriangleSelector.cpp) e no [PrusaSlicer 2.9.4](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.4/src/libslic3r/TriangleSelector.cpp). A variante Prusa tradicional possui um nibble adicional de estado (até 18 filamentos); Bambu/Orca permitem continuação para estados maiores.
