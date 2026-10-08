# Roteiro de evolução

## Atualização 0.3 — Reparo avançado e nova identidade (implementado)

MagnetLab substitui o nome anterior. Segundo motor para pequenos defeitos de conectividade e contornos complexos, validado no STL fornecido pelo usuário. Pacote estático e instruções de hospedagem gratuita.

## Atualização 0.2 — Reparo conservador (implementado)

Malhas defeituosas legíveis abrem para inspeção; correção de duplicatas, degenerados, orientação, união de bordas e pequenos contornos planos. Relatório de alterações e áreas fechadas destacadas. Veja REPARO.md. A reconstrução geral de auto-interseções e o remalhamento global permanecem futuros.

## Etapa 1 — Versão funcional inicial (implementada)

Importação STL, escala explícita, cena navegável, posicionamento pela normal do triângulo, parâmetros de ímã, lista de cavidades, reposicionamento, histórico, cortes reais, corte visual e exportação. Núcleo testado numericamente e benchmark sintético reproduzível.

## Etapa 2 — Validar com peças reais

Prioridade imediata. Importar ao menos um STL do usuário com mais de 300 mil triângulos e inspecionar a região de instalação dos ímãs. Comparar dimensões no fatiador de uso real e imprimir um corpo de prova de encaixe. Registrar tempos, memória observada, falhas topológicas e ajuste de folga. Não é necessário enviar o arquivo a um servidor para usar o site.

Aceite: peça reaberta no fatiador, fundo confirmado, diâmetro e profundidade corretos e encaixe físico satisfatório no material escolhido.

## Etapa 3 — Posicionamento mais preciso

- Estimar normal na vizinhança preservando arestas.
- Inclinação manual e travamento nos eixos.
- Coordenadas numéricas e guias de alinhamento.
- Duplicar com distância e quantidade.
- Modos de embutimento para superfícies curvas.
- Destacar a região de corte, incluindo possível contato com outra superfície.

Aceite: posicionamento estável em curva, sem cruzar automaticamente uma aresta, com profundidade de referência explícita.

## Etapa 4 — Espessura e integridade

- Detector de rompimento no fundo e nas laterais.
- Espessura mínima configurável.
- Aviso de cavidades sobrepostas.
- Diagnóstico de malha mais detalhado, incluindo auto-interseções.
- Controles para arquivo aberto ou incompatível, sem reparos silenciosos.

Aceite: testes com parede fina, casca oca, canto, concavidade e cavidades adjacentes; distinguir falha confirmada de incerteza por amostragem.

## Etapa 5 — Projetos e múltiplas peças

- Salvar/reabrir projeto local versionado.
- Recuperação após falha ou fechamento da aba.
- Várias peças e cavidades alinhadas em pares.
- Marca opcional para identificação de polaridade.
- Presets pessoais de material, impressora e ímã.

Aceite: round-trip completo do projeto, origem/unidade preservadas, cavidades editáveis sem perda e migração explícita do formato.

## Etapa 6 — Cargas grandes e acabamento

- Transferência de buffers em todas as mensagens de geometria.
- Cancelamento e reinício seguro do worker.
- Estimativa de memória antes de alocar modelos grandes.
- Renderização sob demanda e opção de nível de detalhe apenas visual.
- Corte visual com tampa e indicação das paredes.
- Testes em Chrome, Safari, Firefox e dispositivos móveis representativos.
- Fontes servidas localmente e auditoria de acessibilidade.

A sequência prioriza utilidade e correção geométrica. Datas e promessas de desempenho devem ser definidas depois de testar os arquivos reais.
