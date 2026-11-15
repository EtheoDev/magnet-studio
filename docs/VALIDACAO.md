# Validação do MagnetLab

## Atualização 0.6.0 — corte por pintura

O fluxo agora começa pela seleção de uma parte com um clique. A proposta inclui o verso, permite ajustar o alcance e pode ser confirmada ou cancelada. O pincel fica em uma seção opcional para retoques. Os novos testes cobrem uma cabeça selecionada pelo pescoço, redução/ampliação da proposta, confirmação com histórico, um olho independente selecionado por inteiro e um braço sem incluir o tronco ou a cabeça. A suíte atual passou com 78 testes. No navegador, a cabeça e o braço do personagem foram selecionados com um clique; a confirmação foi desfeita e refeita sem pinceladas, e o controle de alcance atualizou a proposta.

Seleção por faces, histórico compacto, contornos, superfícies complementares, chaves com três formas e inversão de macho/fêmea, folgas dimensionais e passagem contínua foram implementados. A suíte completa passou com 75 testes. Os testes incluem superfícies próximas, conexão pelo ombro, fronteiras não planas com variação de 12 mm, duas aberturas de um arco, rejeição de aberturas aninhadas e paredes insuficientes, obstáculos durante inserção e STL com coordenadas preservadas.

No navegador, foram confirmados pintura do braço do exemplo, desfazer/refazer, prévia de suavização, geração de duas peças, chave e liberação das exportações STL. O núcleo foi medido com 2.097.152 triângulos: seleção com pincel de 968 faces em aproximadamente 9 ms, separação/validação/passagem em 22,14 s e chave/passagem em 3,03 s. O pico de RSS no ensaio completo foi aproximadamente 2,72 GB. Passagem livre e STL reimportado com `NoError`. Consulte [o guia de corte por pintura](CORTE-PINTURA.md) e os dois resultados JSON em `tests/paint-*-benchmark-result.json` para os limites dessas medições.

Os dois downloads reais do navegador também foram reimportados: região com 410 triângulos e 5.074,399 mm³, restante com 432 triângulos e 40.127,849 mm³. Ambos tiveram `NoError` e interseção zero nas coordenadas de montagem. A região foi exibida com afastamento de 20 mm, mas o STL manteve a altura original e o pino entre Z −3 e 6 mm, confirmando que o afastamento não entrou no arquivo.

## Atualização 0.3

29 testes automatizados passaram. O STL real de 323.903 triângulos foi reparado, exportado e reimportado. Uma cavidade de teste removeu material e também passou por exportação/reimportação. As dimensões externas foram preservadas. O fluxo também foi confirmado na interface, com reparo em aproximadamente 2,98 segundos e liberação dos controles de cavidades/exportação. Detalhes, medições e limites de amostragem em REPARO.md.

## Atualização 0.2

A suíte passou a 22 testes, incluindo treze casos de reparo. O fluxo de inspeção de malha inválida, reparo de três defeitos simultâneos e liberação das cavidades foi confirmado no navegador. Consulte [o relatório de reparo](REPARO.md).

Os resultados abaixo registram a validação original do corte de cavidades.

Data: 7 de outubro de 2026.

## Testes automatizados

Nove casos geométricos passaram:

1. Cavidade cega: volume removido compatível com o cilindro e malha fechada.
2. Orientação: cortes equivalentes em faces com normais +X, −Y e −Z.
3. Múltiplas cavidades: volume esperado e original preservado.
4. Exportação/reimportação: volume e deslocamento original preservados.
5. Conversão de polegadas para milímetros.
6. Rejeição de malha aberta.
7. Rejeição de dimensões, normal e arquivo inválidos.
8. Importação de STL ASCII fechado.
9. Rejeição de contagem binária corrompida antes da alocação do parser.

Execução reproduzível: `npm test`.

## Benchmark do motor geométrico

Esfera sintética fechada com **524.288 triângulos**, arquivo STL de **26,21 MB**. Ambiente Node.js v24.15.0, macOS ARM64. Uma cavidade de 6,20 × 3,10 mm no topo.

| Etapa | Duração observada |
|---|---:|
| Leitura e indexação | 465 ms |
| Construção/validação do sólido | 354 ms |
| Construção da BVH | 165 ms |
| Corte e obtenção da malha | 360 ms |
| Escrita STL | 264 ms |

O STL resultante foi reimportado com estado `NoError`. Tempos sujeitos a variação. Esses números medem o núcleo em Node.js, não o tempo completo de interface no navegador e não garantem desempenho em qualquer STL ou dispositivo.

Execução reproduzível: `npm run benchmark`. Resultado estruturado em `tests/benchmark-result.json`.

## Verificação de interface

A versão local foi aberta no navegador integrado. Confirmados: carregamento da demonstração, visualização 3D, ativação do posicionamento, clique na superfície, seleção da cavidade e cálculo do corte real. O resultado de uma cavidade padrão removeu aproximadamente 93,4 mm³ e apareceu visualmente aberto na peça.

A mesma esfera de **524.288 triângulos** foi importada pela interface: aproximadamente **1,04 s** para preparar no worker e **0,51 s** para calcular a cavidade, obter a malha e construir sua BVH. O clique em Exportar acionou a geração do arquivo; a captura automatizada do download pelo navegador integrado não foi concluída, portanto a gravação final nessa interface específica não foi verificada. A exportação binária foi validada independentemente nos testes de round-trip.

Na compilação de produção, também foram confirmados edição de diâmetro com atualização da lista, desfazer/refazer e geração de um novo STL a partir dos parâmetros editados. Um link de download manual permanece disponível após a geração.

A interface tem disposição desktop em três colunas e adaptação para telas estreitas, com a cena acima dos controles. O teste visual não substitui uma matriz completa de navegadores e dispositivos.

## Limites da validação

- Ainda não houve teste com um STL real fornecido pelo usuário.
- Ainda não houve abertura em um fatiador externo nem impressão física.
- A espessura mínima de parede não é verificada automaticamente.
- A documentação especifica orientação suavizada, inclinação manual e projetos salvos como etapas futuras.
