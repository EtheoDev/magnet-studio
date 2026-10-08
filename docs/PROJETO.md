# MagnetLab — Documento de produto e arquitetura

Versão 0.3 · 8 de outubro de 2026

**Atualização:** arquivos com malha defeituosa agora podem abrir para inspeção e receber reparo simples e avançado de pequenos defeitos. Consulte [Reparo de STL](REPARO.md) para opções, limites e testes.

## 1. Objetivo

Criar uma ferramenta online dedicada a acrescentar cavidades de ímãs em peças STL, com posicionamento diretamente sobre a superfície. A interação toma como referência o gesto de posicionar furos de drenagem em fatiadores: um cilindro acompanha o cursor, adapta sua orientação à superfície e é fixado com um clique.

O resultado é um STL com o volume das cavidades realmente removido, que pode ser aberto em outros fatiadores. Não é apenas uma representação visual nem uma instrução específica de um fatiador.

### Público e contexto

Pessoas que imprimem miniaturas, bases, tampas, encaixes e peças desmontáveis e desejam instalar ímãs sem aprender um modelador completo. A interface é em português e as medidas de edição são em milímetros. Resina e filamento são contemplados com folgas configuráveis; não se assume uma calibração universal.

### Definição de sucesso

1. Importar um STL fechado e conferir suas dimensões.
2. Informar tamanho do ímã e folgas com significado inequívoco.
3. Posicionar uma ou mais cavidades sobre a peça.
4. Conferir o resultado do corte.
5. Exportar um STL fechado, com as medidas e coordenadas preservadas.
6. Abrir o arquivo no fatiador e, posteriormente, validar o encaixe em uma impressão de teste.

## 2. Escopo por estado de implementação

| Recurso | Estado na versão 0.1 |
|---|---|
| Importar STL ASCII e binário | Implementado |
| Visualizar, girar, aproximar e enquadrar | Implementado |
| Unidade de entrada mm, cm ou polegadas | Implementado |
| Cilindro sobre a superfície | Implementado, normal do triângulo |
| Selecionar diâmetro, espessura e folgas | Implementado |
| Múltiplas cavidades independentes | Implementado |
| Reposicionar sobre outra superfície | Implementado |
| Excluir, desfazer e refazer | Implementado |
| Subtração geométrica e exportação STL | Implementado |
| Corte visual por plano | Implementado, eixo X, sem tampa |
| Processar arquivo sem upload | Implementado |
| Orientação suavizada em superfícies curvas | Planejado |
| Inclinação manual e travamento por eixo | Planejado |
| Verificação completa de parede mínima | Planejado |
| Ímãs em pares entre peças | Planejado |
| Duplicação com espaçamento numérico | Planejado |
| Salvar e reabrir projeto editável | Planejado |
| Reparação conservadora de malha | Implementado, acionado pelo usuário |
| Arquivos 3MF, OBJ e STEP | Fora da versão inicial |

A versão inicial não deve ser apresentada como equivalente a um CAD de uso geral ou como garantia automática de imprimibilidade.

## 3. Jornada de uso

### Importação

O usuário escolhe a unidade original e abre ou arrasta um arquivo STL. O seletor de unidade vale para a próxima importação; não redimensiona um modelo já carregado. STL não carrega uma unidade padronizada, portanto a escolha deve ser confirmada pelas dimensões exibidas.

O arquivo é lido em ArrayBuffer e enviado ao processamento em segundo plano. Uma malha fechada e orientada é exigida para cortar e exportar. Malhas legíveis com defeitos abrem para inspeção e reparo, com os controles de cavidades bloqueados até a correção. Falhas de leitura conservam o modelo anterior quando o worker está operacional.

Importar com sucesso outro arquivo substitui o projeto em memória, inclusive seu histórico. Essa versão não conserva um projeto entre sessões.

### Definição do ímã

O usuário pode escolher presets de disco de 3 × 2, 5 × 2, 6 × 3, 8 × 3 e 10 × 3 mm, ou informar medidas personalizadas. Presets representam a geometria nominal do ímã, não uma calibração validada de impressão.

A folga no diâmetro é **total**, e não por lado. A folga no fundo aumenta a profundidade da cavidade. Valores iniciais de 0,20 mm no diâmetro e 0,10 mm no fundo são exemplos ajustáveis, não recomendações universais.

Exemplo: ímã de 6 × 3 mm, folga diametral de 0,20 mm e folga axial de 0,10 mm produzem cavidade de 6,20 mm de diâmetro e 3,10 mm de profundidade.

### Posicionamento

“Adicionar cavidade” ativa o cursor de posicionamento. Um raycast encontra a superfície externa visível. A normal orientada para fora define a direção do encaixe; o cilindro avança para dentro da peça. Faces vistas pelo lado interno são rejeitadas para evitar a inversão silenciosa da orientação.

Clique fixa uma cavidade e retorna ao modo de inspeção. Esc cancela o posicionamento. A lista permite selecionar e editar cada cavidade. “Reposicionar” permite trocar ponto e normal mantendo suas medidas. O modelo original permanece como referência de posicionamento, mesmo quando o resultado dos cortes está sendo exibido.

### Conferência e exportação

“Conferir cortes” calcula as subtrações e apresenta a malha resultante. Editar uma cavidade volta à visualização do original com seus indicadores; uma nova conferência recalcula a partir do original. A exportação recalcula resultados pendentes antes de gerar o arquivo, evitando exportar uma versão desatualizada.

O arquivo exportado recebe o sufixo `-imas.stl`. As coordenadas são em milímetros, com o deslocamento original restaurado. O STL de entrada não é sobrescrito.

## 4. Semântica geométrica

### Sistema de coordenadas

- Edição e exportação em milímetros.
- Z é a direção vertical da cena.
- A malha é centralizada numericamente para reduzir perda de precisão em modelos longe da origem.
- O deslocamento da caixa delimitadora é guardado e restaurado na exportação.
- Não se aplica rotação automática ao STL.

A demonstração é criada diretamente na cena e não tem um arquivo original a preservar.

### Cavidade cilíndrica

Sejam P o ponto selecionado, N a normal unitária orientada para fora, D o diâmetro nominal e H a espessura nominal. Com folgas Fd e Fh:

- diâmetro de corte = D + Fd;
- raio de corte = (D + Fd) / 2;
- profundidade de corte = H + Fh;
- centro do fundo = P − N × (H + Fh).

Uma base ortonormal U, V, N é construída para transformar o cilindro local, originalmente alinhado ao eixo Z, para a orientação da superfície.

O fundo do cortador fica na profundidade desejada. Seu topo avança para fora da superfície, com extensão local de `max(0,5 mm, raio)`. Esse prolongamento evita uma coincidência exata entre a tampa do cilindro e uma superfície plana. Em uma superfície muito curva ou com outras regiões próximas, ele não é garantia de abertura completa nem de ausência de cortes colaterais. Esses casos exigem inspeção nesta versão; detecção da região local é uma evolução prevista.

### O que “rente” significa

A referência atual é o plano tangente ao triângulo no ponto clicado. A profundidade é medida axialmente a partir desse ponto. Um ímã plano não acompanha toda uma superfície curva. Em curvas, partes do ímã podem ficar mais salientes ou mais embutidas.

Futura evolução: amostrar a região ocupada pelo ímã e oferecer modos explícitos “referência no centro”, “totalmente embutido” e “rebaixo adicional”. Nenhum desses modos extras é simulado como se já estivesse implementado.

### Resolução do cilindro

A tesselação busca erro de corda de até aproximadamente 0,005 mm no raio, limitado entre 64 e 512 segmentos. O cilindro exportado é poligonal, como qualquer STL. A tolerância geométrica de modelagem não substitui a precisão da impressora.

### Cavidades sobrepostas

As subtrações são aplicadas sequencialmente; volumes sobrepostos não são removidos duas vezes. A primeira versão permite sobreposição e não oferece um aviso dedicado de colisão entre encaixes.

## 5. Arquitetura

A aplicação é estática, compilada com Vite. A hospedagem distribui HTML, CSS, JavaScript e WebAssembly. Não há backend de geometria, banco de dados, conta própria ou serviço de upload de STL.

```text
Arquivo local STL
      │
      ▼
Interface / cena Three.js ───── cavidades parametrizadas
      │                              │
      ▼                              ▼
Web Worker: parser → sólido Manifold → subtrações
      │                              │
      ├── geometria + BVH ───────────► cena
      └── STL binário ───────────────► download local
```

### Camada de interface

`src/main.js` controla os painéis, o histórico, os parâmetros, o cursor, os comandos e a revisão atual. Three.js renderiza a cena com OrbitControls. A BVH acelera a consulta da superfície. Marcadores de cavidades são objetos de prévia separados da malha original.

A renderização permanece no contexto principal. Operações de importação, validação, booleanas e construção da BVH acontecem no worker. A atribuição da malha à GPU ainda pode gerar uma pausa breve em modelos grandes.

### Núcleo geométrico

`src/repair.js` contém o reparo conservador, com limpeza, orientação, união de bordas e fechamento limitado de contornos. Veja o documento REPARO.md.

`src/geometry.js` contém funções compartilhadas com os testes: leitura de STL, indexação de posições, criação de sólidos, parâmetros, matriz de orientação, operações booleanas e gravação STL.

Vértices com coordenadas exatamente iguais são unificados. A importação não aplica soldagem por proximidade. O comando de reparo pode unir vértices de bordas dentro da tolerância explicitamente escolhida; não há soldagem ampla ou remalhamento global.

Manifold valida se a malha atende à estrutura topológica exigida e calcula as booleanas. A importação não constitui teste completo de todas as auto-interseções possíveis. O sistema não aplica remalhamento global nem redução de polígonos por padrão.

### Worker

`src/geometry.worker.js` carrega o módulo WASM uma vez, mantém a peça original e o último resultado e atende mensagens:

| Mensagem | Entrada | Saída |
|---|---|---|
| `demo` | Sem arquivo | Geometria de demonstração e BVH |
| `import` | Buffer STL e escala | Geometria validada, dimensões, BVH e volume |
| `repair` | Tolerância de união e limite dos buracos | Malha corrigida, relatório, áreas fechadas e BVH |
| `cut` | Lista de cavidades | Malha resultante, BVH, volume e duração |
| `export` | Sem parâmetros extras | Buffer STL do último resultado válido |

As mensagens usam identificador de requisição e resposta `ok`/`error`. O buffer de entrada e o de exportação usam transferência de propriedade. As respostas de geometria usam cópia estruturada nesta versão; transferir todos os buffers é uma otimização futura.

Operações têm timeout de 120 segundos. Se o worker falhar ou exceder o tempo, ele é encerrado e a interface informa a necessidade de recarregar e reimportar. Ainda não existe recuperação automática do worker nem cancelamento independente por operação.

### Modelo de cavidade

```json
{
  "id": "identificador-local",
  "point": [0, 0, 10],
  "normal": [0, 0, 1],
  "diameter": 6,
  "thickness": 3,
  "diameterAllowance": 0.2,
  "depthAllowance": 0.1
}
```

As posições referem-se à malha centralizada. Futuro arquivo de projeto deverá armazenar também versão do esquema, unidade escolhida, deslocamento original, modelo base e identificação inequívoca do arquivo.

## 6. Desempenho e memória

300 mil triângulos não são um impedimento intrínseco, mas triângulos não são a única variável: importam qualidade da malha, quantidade de componentes, complexidade local, número de cavidades, navegador e memória do dispositivo.

Um STL binário com N triângulos ocupa 84 + 50 × N bytes. Para 300 mil triângulos são aproximadamente 15 MB no arquivo. Memória durante a edição é maior: arrays descompactados, índices, BVH, cópias da comunicação, sólido WASM, buffers de renderização e resultado coexistem.

Estratégia implementada:

- não recalcular booleanas durante o movimento do cursor;
- manter o original e os parâmetros separados;
- construir a BVH em segundo plano;
- reconstruir a BVH após alterar a topologia;
- liberar objetos WASM substituídos e geometrias de visualização descartadas;
- limitar histórico a 50 alterações paramétricas;
- limitar pixel ratio de renderização a 2.

Limites de admissão atuais: 200 MB, 3 milhões de triângulos e 100 cavidades. São proteções contra cargas excessivas, não uma promessa de que todos os modelos nesses limites funcionarão. STL ASCII é verificado por contagem após a leitura; um arquivo textual muito grande ainda pode pressionar a memória antes da rejeição por triângulos.

O benchmark reproduzível usa uma esfera sintética fechada com mais de 300 mil triângulos. Os tempos medidos devem ser identificados pelo ambiente. Resultados em Node.js não são uma garantia de desempenho do navegador ou de modelos orgânicos defeituosos.

## 7. Integridade e limitações

### Verificações atuais

- números finitos e limites de medidas;
- normal unitária;
- STL não vazio, dimensões tridimensionais e limites de carga;
- orientação e topologia aceitas pelo Manifold;
- sólido resultante não vazio;
- teste de exportação/reimportação e volume nos casos automatizados.

### Verificações futuras de espessura

Um único raio pelo centro da cavidade não basta. A verificação deverá considerar todo o fundo e a parede lateral, além de descontinuidades, regiões curvas e peças ocas. Uma abordagem inicial pode combinar raios distribuídos no disco e na circunferência com consultas de distância. Por ser amostragem, deve declarar sua resolução e limites. Uma garantia robusta exige uma abordagem conservadora de volume/offset e tratamento de tolerâncias.

O produto deverá diferenciar claramente:

- rompimento confirmado;
- parede abaixo da espessura escolhida;
- região não verificada com confiança;
- região aprovada segundo o método e a tolerância declarados.

### Riscos de fabricação

Folga correta depende do processo, material, compensações do fatiador, orientação, contração, cola e variação dimensional do ímã. A validação final exige corpo de prova físico. A ferramenta não altera polaridade nem organiza pares de ímãs nesta versão.

## 8. Privacidade, distribuição e dependências

Os arquivos STL são lidos pelo navegador e não são enviados ao serviço de hospedagem. Não há telemetria de modelo implementada. Bibliotecas e WASM são distribuídos com a aplicação. Google Fonts pode receber requisições das fontes da interface, sem conteúdo do STL.

A publicação inicial é privada para o proprietário. Autenticação e disponibilidade de hospedagem dependem da plataforma Sites. O projeto também pode ser executado localmente ou hospedado como site estático compatível com JavaScript modules, Web Workers e WASM.

Dependências e versões estão em `package.json` e `package-lock.json`. A versão publicada deve corresponder ao código-fonte e ao arquivo de compilação usados na validação. Manter avisos/licenças das bibliotecas ao redistribuir.

## 9. Critérios de aceitação

- Cubo fechado com cavidade axial: volume removido corresponde ao cilindro, respeitando tesselação.
- Faces em X, Y e Z: mesma profundidade e diâmetro.
- Duas cavidades separadas: volume removido é a soma esperada.
- Exportar e reimportar: malha continua aceita pelo motor e volume é conservado dentro da tolerância numérica.
- Modelo deslocado: exportação conserva as coordenadas originais.
- Entrada em polegadas: escala convertida corretamente para mm.
- Malha aberta: erro legível, sem fingir sucesso.
- Interface: adicionar, editar, reposicionar, apagar, desfazer, conferir e exportar usam o estado atual.
- Malha acima de 300 mil triângulos: benchmark documentado e, antes de prometer suporte amplo, ensaio com arquivos reais.

## 10. Referências primárias

- [Three.js — STLLoader](https://threejs.org/docs/pages/STLLoader.html): entrada ASCII/binária.
- [Three.js — Raycaster](https://threejs.org/docs/pages/Raycaster.html): seleção de superfícies.
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh): consultas espaciais aceleradas.
- [Manifold WASM](https://manifoldcad.org/docs/jsapi/): sólidos e operações booleanas.
- [Manifold — código e limitações](https://github.com/elalish/manifold): contrato geométrico e distribuição.
- [Lychee — Export 3D](https://doc.mango3d.io/doc/resin-documentation/resin-export/export-3d/): referência de interação e restrições da conversão de furos de drenagem.

As decisões de UX, dimensões iniciais, limites e arquitetura deste documento são propostas e escolhas do MagnetLab, não garantias fornecidas por essas bibliotecas.

## Reparo avançado e publicação — 0.3

A etapa avançada usa meshfix-wasm 0.6.1 em Web Worker após falha do reparo simples. O resultado é comparado com o original e validado pelo motor de cavidades. Consulte REPARO.md para os limites e a validação com uma peça real de 323.903 triângulos. PUBLICAR.md descreve o envio da compilação estática ao Cloudflare Pages.
