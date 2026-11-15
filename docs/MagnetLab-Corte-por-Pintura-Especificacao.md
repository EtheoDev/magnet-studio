# MagnetLab — corte anatômico por pintura

Data: 14/10/2026. Estado: fluxo implementado na versão 0.6.0, com validações e limites descritos em [CORTE-PINTURA.md](CORTE-PINTURA.md). A referência abaixo permanece como especificação; equivalência completa ao acabamento manual em qualquer personagem não foi comprovada.

## Referência observada

Vídeo: [Cómo hacer cortes y encastres para impresión 3D, D1nuz](https://www.youtube.com/watch?v=KPhKW_dZhkk). A análise combina a transcrição automática em espanhol com inspeção de quadros das operações; não é uma transcrição revisada integralmente.

- [4:38–6:29](https://www.youtube.com/watch?v=KPhKW_dZhkk&t=278s): pintar a região como Face Set, contornando e preenchendo a perna.
- [6:31–7:12](https://www.youtube.com/watch?v=KPhKW_dZhkk&t=391s): suavizar a fronteira.
- [7:47–8:16](https://www.youtube.com/watch?v=KPhKW_dZhkk&t=467s): converter a região em máscara e separar com Mask Slice to New Object.
- [8:29–13:54](https://www.youtube.com/watch?v=KPhKW_dZhkk&t=509s): refazer a tampa da perna; criar inset, elevar e aplanar a região interna; refinar e suavizar localmente.
- [14:00–15:47](https://www.youtube.com/watch?v=KPhKW_dZhkk&t=840s): preparar o corpo e subtrair a perna ajustada para compatibilizar as superfícies.
- [16:00–19:41](https://www.youtube.com/watch?v=KPhKW_dZhkk&t=960s): posicionar uma chave, criar uma cópia maior para a folga, unir o macho e subtrair o alojamento.

O ponto central é separar três decisões: contorno externo, superfície interna de assentamento e chave mecânica.

## Experiência proposta para o MagnetLab

### 1. Pintar a região

O usuário escolhe o pincel, gira o personagem e pinta o membro inteiro que deseja destacar. A pintura acompanha os triângulos da superfície e continua ao mudar a câmera. Controles: adicionar, apagar, tamanho do pincel, desfazer/refazer e inverter seleção. O cursor mostra a área atingida.

O padrão deve atingir somente a superfície visível e conectada ao ponto tocado. Pintar o braço próximo ao tronco não pode selecionar o tronco por proximidade espacial. Pintar através da peça, se incluído, precisa ser uma opção explícita.

### 2. Conferir o contorno

Destacar a fronteira entre região selecionada e restante. Oferecer suavização com intensidade e prévia, além de correções locais. Informar seleções isoladas, contornos múltiplos e fronteiras ambíguas. Não presumir que a parte de trás foi pintada: o usuário deve poder girar e inspecionar a seleção completa.

A fronteira poderá acompanhar ombro, roupa, musculatura ou outra característica anatômica. Nenhuma restrição a uma vista fixa ou a avançar da esquerda para a direita.

### 3. Separar e preparar o assentamento

Extrair a região e o restante preservando as coordenadas de montagem. Construir uma transição interna a partir do contorno: faixa de borda, ressalto ou rebaixo e área de apoio. Parâmetros: largura da faixa, profundidade e direção de montagem, com inversão do lado macho.

A criação dessa superfície exige um algoritmo próprio e validação em contornos não planos. Uma triangulação simples em leque não deve ser assumida como suficiente. A superfície complementar deve derivar da mesma referência geométrica, evitando duas tampas suavizadas independentemente que deixem de combinar.

A suavização deve ficar restrita à região de transição. A superfície externa fora dessa faixa deve permanecer preservada. Alterações inevitáveis na borda precisam aparecer na prévia.

### 4. Colocar o encaixe

O usuário posiciona uma chave na superfície preparada, com movimentação e rotação livres. Formas desejadas: pino redondo, chave retangular e chave com afunilamento de entrada. Deve poder inverter a peça que recebe o macho, especialmente quando vários membros compartilham pouco espaço interno.

Folgas em milímetros: lateral por lado, fundo e assentamento. Aumentar o alojamento deve aplicar uma distância definida; escalar percentualmente a peça inteira não garante folga uniforme. Perfis de resina e filamento continuam ajustáveis e precisam de calibração física. Não extrair uma tolerância universal de uma indicação visual ou da transcrição automática do vídeo.

### 5. Conferir e exportar

Mostrar região original, peças separadas e montagem. Verificar fechamento, orientação, interseções, ilhas, espessura disponível e passagem durante a inserção. Ausência de colisão na posição final não garante que o encaixe consiga deslizar até ela.

Exportar cada peça em STL. Preservar escala e posição de montagem; o afastamento da prévia não altera os arquivos. O suporte a projetos LYS com suporte redistribuído permanece uma questão separada.

## Mudança de arquitetura necessária

O mecanismo de perfil extrudado da versão 0.5.0 não representa esta seleção tridimensional. A substituição exige:

1. Seleção por face, com histórico compacto das faces alteradas em cada pincelada.
2. Busca espacial pelo BVH existente e vizinhança topológica para restringir o pincel à superfície correta.
3. Extração de contornos entre faces selecionadas e não selecionadas, incluindo diagnóstico de ambiguidades.
4. Refinamento local e geração das superfícies de fechamento e assentamento em Worker.
5. Reutilização de Manifold para operações de sólido, chaves e verificações, após obter geometrias fechadas válidas.

O risco técnico principal está nas superfícies internas de contornos muito não planos, próximos de outras partes do personagem ou com várias aberturas. A implementação deve ser comprovada nesses casos antes de ser apresentada como equivalente ao fluxo da referência.

## Critérios de aceite

- Pintar e apagar um braço inteiro, girando a câmera, sem selecionar o tronco ou o outro braço.
- Desfazer uma pincelada sem reconstruir todo o modelo.
- Separar um membro com contorno ao redor de toda a sua circunferência.
- Fechar ambas as partes sem ilhas inesperadas ou faces invertidas.
- Manter as coordenadas externas fora da faixa de alteração acordada.
- Gerar assentamentos compatíveis e uma direção viável de montagem.
- Criar e inverter macho/fêmea com folgas mensuráveis.
- Exportar/reimportar as partes e conferir os volumes e encaixes.
- Medir tempo e memória em modelos com mais de dois milhões de triângulos, sem prometer capacidade ilimitada de memória.

## Referência técnica complementar

O [manual oficial do Draw Face Sets no Blender 4.2](https://docs.blender.org/manual/en/4.2/sculpt_paint/sculpting/tools/draw_facesets.html) descreve a continuação do mesmo conjunto com Ctrl e a suavização das fronteiras com Shift, que modifica a topologia subjacente. Isso confirma que o acabamento da fronteira exige tratamento geométrico além da simples atribuição de cor.
