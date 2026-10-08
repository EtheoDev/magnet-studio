# Reparo de STL — MagnetLab 0.3

Atualização de 8 de outubro de 2026.

## Como usar

1. Importe o STL, mesmo com defeitos. Malhas legíveis abrem para inspeção.
2. Clique em **Reparar malha**. A opção **Reparar conexões e contornos complexos** vem ativada.
3. A ferramenta tenta primeiro as correções simples. Se elas não produzirem um sólido aceito pelo motor de cavidades, tenta o reparo avançado sobre uma nova cópia do original.
4. Confira o relatório e as faces reparadas em laranja. O destaque pode ser desligado e é ocultado ao conferir os cortes, para não cobrir a cavidade com faces antigas.
5. Adicione ímãs ou exporte apenas a peça corrigida. Sem cavidades, o nome termina em `-reparado.stl`.

O original não é sobrescrito. Resultados incompletos não substituem a peça atual. Todo o processamento fica no dispositivo, em Web Worker; o arquivo não é enviado a um serviço de reparo.

## O problema corrigido nesta versão

O reparo anterior interrompia o processamento ao encontrar arestas com mais de duas faces. Além disso, a união por proximidade podia criar conexões inválidas adicionais. Agora essa união é descartada quando aumenta o número dessas arestas, e existe uma segunda tentativa de reconstrução local.

O reparo avançado usa **meshfix-wasm 0.6.1**, baseado em PMP Library. Ele reorganiza conexões, separa vértices compartilhados incorretamente, fecha pequenos contornos e trata triângulos degenerados. Não aplica uma redução global de polígonos nem reconstrução por voxels.

## Opções

**Unir vértices até:** tolerância de proximidade da etapa simples, em milímetros. Padrão 0,001; intervalo 0 a 0,1. Zero desativa a união. Apenas vértices nas bordas abertas são candidatos; a posição de um deles é mantida. A etapa avançada não adiciona soldagem por proximidade.

**Fechar buracos até:** limite em milímetros da diagonal da caixa delimitadora de cada contorno. Padrão 5; intervalo 0 a 100. Zero desativa o fechamento em ambas as etapas. Na etapa avançada, todos os contornos são medidos antes de qualquer preenchimento; se algum ultrapassar o limite, a tentativa é rejeitada.

**Reparar conexões e contornos complexos:** desative para executar somente o reparo simples. O motor avançado é carregado apenas quando necessário.

A etapa simples fecha contornos sem ramificações, aproximadamente planos (desvio de até 0,01 mm) e sem sobreposição ou aninhamento ambíguo. A etapa avançada também tenta contornos complexos e não planos. Contornos que o motor avançado classifica como aberturas intencionais são preservados; se isso impedir um sólido fechado, o resultado não é aplicado.

## Validação e limites

O resultado precisa passar pela análise de fechamento/conectividade e ser aceito pelo Manifold, que realiza os cortes. Não basta ocultar a mensagem de erro.

Na etapa avançada, as faces são comparadas com o original por suas coordenadas. As novas faces aparecem em laranja. O relatório informa faces novas/reconstruídas e faces originais removidas/substituídas, incluindo aquelas rejeitadas na leitura interna do motor.

Verificamos distâncias à superfície nos três vértices e no centro de cada face alterada, em ambos os sentidos. Se alguma amostra ultrapassar **0,05 mm**, a tentativa é rejeitada. O valor mostrado é uma **medição por amostragem**, não uma prova do erro máximo contínuo nem garantia de tolerância dimensional em toda a peça.

Limites: 1 milhão de triângulos para reparar, 1.000 contornos, 1.024 arestas por contorno e 50 mil faces somadas entre novas e removidas no reparo avançado. A importação de malhas já válidas continua aceitando até 3 milhões de triângulos e 200 MB. Recursos limitados do dispositivo podem reduzir a capacidade prática.

O reparo não resolve qualquer STL. Auto-interseções, regiões extensas ausentes, superfícies muito ambíguas e arquivos ilegíveis ainda podem ser recusados. A aprovação geométrica não é uma auditoria completa de fabricação. A classificação de aberturas e de cascas internas usa heurísticas; confira a peça antes de imprimir.

## Validação com o STL fornecido

Arquivo local de teste: braço direito do Sheldon. O arquivo do usuário não integra o código-fonte, o pacote de publicação ou uma demonstração pública.

| Medida | Resultado |
|---|---|
| Triângulos originais | 323.903 |
| Bordas abertas no diagnóstico inicial | 500 |
| Arestas com mais de duas faces no diagnóstico inicial | 7 |
| Contornos fechados pela etapa avançada | 67 |
| Triângulos no sólido reparado | 324.246 |
| Faces novas ou reconstruídas | 730 |
| Faces originais removidas ou substituídas | 387 |
| Maior distância nas amostras verificadas | 0,002642 mm |
| Dimensões antes e depois | 10,548798 × 14,186893 × 13,646313 mm |
| Volume após reparo e após exportação/reimportação | 577,427149 mm³ |
| Cavidade de teste | 3,2 mm de diâmetro × 1,1 mm de profundidade |
| Material removido no teste | 8,295924 mm³ |

A cavidade foi usada somente para validar a operação; a cópia reparada entregue não contém essa cavidade. O hash do original foi verificado novamente após o teste e permaneceu idêntico.

O reparo avançado isolado levou cerca de 2,4 segundos em Node.js/macOS ARM64. Esse tempo não inclui todas as etapas da interface e não é garantia para outros arquivos ou dispositivos.

Uma exportação STL repete coordenadas e perde a identidade dos vértices. Superfícies que se tocam podem voltar a aparecer como arestas compartilhadas ao indexar apenas por coordenadas; por isso a validação inclui a reimportação e aceitação pelo motor de sólidos, além da análise da estrutura interna reparada.

No navegador integrado, o original foi aberto em modo de inspeção, reparado pelo botão e convertido em uma malha de 324.246 triângulos. O relatório confirmou os 67 contornos fechados e liberou os controles de cavidades e exportação. O tempo total informado foi 2,98 segundos.

## Testes reproduzíveis

```sh
npm test
node tests/repair-file.js '/caminho/arquivo.stl' '/caminho/copia-reparada.stl'
```

O segundo comando é opcional e utiliza um arquivo local informado pelo operador. Gera a cópia reparada e um relatório JSON, testa corte, exportação, reimportação e preservação do original. O STL não é incluído no repositório. A suíte cobre também recusa de alterações excessivas, limite de buracos, desativação do reparo avançado, preservação de peças ocas e carregamento sob demanda.
