# MagnetLab

Editor web de cavidades cilíndricas para ímãs em arquivos STL. Versão 0.3: 8 de outubro de 2026.

## Executar localmente

Requisitos: Node.js 22.12+ ou 24, npm e um navegador com WebGL e WebAssembly.

```sh
npm ci
npm run dev
```

Abra a URL mostrada no terminal. O modelo de demonstração é carregado automaticamente. Os STLs são processados em memória no dispositivo; não são enviados ao servidor.

## Comandos

```sh
npm test          # verificação da geometria e exportação
npm run benchmark # esfera sintética com mais de 300 mil triângulos
npm run build    # site estático em dist/
npm run preview  # prévia da compilação de produção
```

Leia [a documentação completa](docs/PROJETO.md), [os testes e limitações](docs/VALIDACAO.md) e [o roteiro de evolução](docs/ROADMAP.md).

## Reparo de STL

Malhas legíveis com defeitos abrem para inspeção. O painel “Reparar malha” permite corrigir duplicatas, faces sem área, orientação, pequenas separações de vértices e buracos planos simples. Se necessário, tenta reconstruir conexões e contornos complexos com um motor WASM adicional. As regiões fechadas são destacadas. Veja [opções e limites do reparo](docs/REPARO.md).

## O que está implementado

- STL binário e ASCII; conversão de mm, cm e polegadas.
- Visualização 3D com órbita, enquadramento, vista superior, malha e corte visual.
- Clique sobre a superfície, alinhamento pela normal do triângulo e cilindro de prévia.
- Múltiplas cavidades, parâmetros individuais, reposicionamento, exclusão e desfazer/refazer.
- Subtração de sólidos com Manifold em Web Worker e exportação STL binária.
- Validação topológica inicial, mensagens de erro e guia de uso.

## Limitações da versão 0.3

A aprovação topológica não é uma auditoria completa de auto-interseções ou de fabricação. A ferramenta não verifica automaticamente se uma cavidade rompe a lateral ou o fundo da peça. O corte visual não adiciona tampa à seção. A orientação segue o triângulo clicado, sem suavização regional ou inclinação manual. Não há persistência de projeto: recarregar ou importar outra peça descarta as cavidades. Modelos grandes e complexos podem exceder os recursos do dispositivo; 3 milhões de triângulos e 200 MB são limites de admissão, não uma garantia de desempenho.

## Organização

- `src/main.js`: interface, cena, posicionamento e estado de edição.
- `src/geometry.js`: importação, indexação, parâmetros, cortadores e exportação.
- `src/repair.js`: reparo conservador de malhas.
- `src/repair-advanced.js`: reparo de conexões e contornos complexos, com comparação de superfície.
- `src/repair-solid.js`: tentativa simples, fallback avançado e validação do sólido.
- `src/geometry.worker.js`: processamento pesado e construção da BVH.
- `src/style.css`: interface responsiva.
- `tests/`: testes numéricos e benchmark reproduzível.
- `docs/`: documentação técnica e plano de evolução.
- `.openai/hosting.json`: configuração do site privado.


