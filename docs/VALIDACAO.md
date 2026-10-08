# Validação do MagnetLab

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
