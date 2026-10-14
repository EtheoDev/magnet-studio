# Cortes orgânicos — MagnetLab 0.5.0

A ferramenta divide uma peça fechada em duas partes a partir de uma curva desenhada na visualização 3D. Pinos redondos integrados ou encaixes quadrados profundos podem unir as partes. Processamento e arquivos permanecem no dispositivo.

## Fluxo

1. Importe um STL, confira as dimensões e repare a malha se necessário. As cavidades de ímã configuradas são calculadas antes da divisão.
2. Abra **Cortes orgânicos**. Escolha Frente, Lateral ou Topo: essa vista define a direção que atravessa a espessura.
3. Clique em **Desenhar curva**. Arraste da esquerda para a direita, começando antes da borda esquerda e terminando depois da borda direita. Também é possível clicar sucessivamente para definir pontos; use Terminar desenho ao concluir. Desfazer ponto e Limpar permitem corrigir a linha.
4. Escolha Resina ou Filamento como ponto de partida. Opcionalmente adicione um ou mais encaixes. Cada encaixe mantém tipo, medidas, folgas e posição próprios.
5. Ajuste a posição horizontal e a posição na espessura, em milímetros em relação ao centro do modelo importado. A marca na peça mostra o encaixe selecionado. A profundidade determina quanto ele avança além do ponto mais alto da face B sob sua largura. Depois de conferir uma divisão, o botão **Adicionar encaixe na face** permite clicar diretamente na superfície de corte exposta para criar outro encaixe.
6. Use **Conferir divisão**. A parte A aparece verde e recebe o macho; a parte B aparece âmbar e recebe o alojamento. Separe a prévia, gire a peça e confira os dois lados.
7. Exporte A e B separadamente. Os STLs preservam as coordenadas originais de montagem; a separação visual não é aplicada aos arquivos. Oriente cada parte para impressão no fatiador.

Alterar qualquer medida, curva ou posição invalida a divisão e seus downloads. Calcule novamente antes de exportar. O original não é sobrescrito. Projetos de corte ainda não persistem entre recarregamentos da página.

## Encaixes e folgas

| Perfil inicial | Forma | Largura/diâmetro | Profundidade | Folga por lado | Folga no fundo | Parede mínima |
|---|---|---:|---:|---:|---:|---:|
| Resina | Pino redondo | 4 mm | 4 mm | 0,15 mm | 0,30 mm | 1 mm |
| Filamento | Encaixe profundo quadrado | 6 mm | 8 mm | 0,25 mm | 0,40 mm | 1,5 mm |

Esses valores são escolhas iniciais do MagnetLab para peças impressas separadamente, e não garantias de encaixe ou valores universais de fabricantes. A folga **por lado** aumenta a largura total do alojamento em duas vezes seu valor: um pino de 4 mm com 0,15 mm por lado gera alojamento de 4,30 mm. A folga entre as faces é total, medida na direção de montagem e dividida igualmente entre A e B (inicialmente 0,10 mm para resina e 0,20 mm para filamento). Use zero se quiser faces coincidentes. A folga no fundo aumenta somente o alojamento, evitando que o macho encoste no fim antes de as faces se encontrarem.

O encaixe profundo é um macho quadrado e seu alojamento, ambos paralelos à direção de montagem. Não é uma cauda de andorinha, trava flexível ou rosca. O pino redondo é integrado à parte A; não há pino avulso nesta versão.

Resina, exposição, lavagem, pós-cura, filamento, retração e ajustes da impressora influenciam o resultado. Imprima uma amostra com o mesmo material, orientação e processo antes de repetir o encaixe numa peça grande. A documentação da [Prusa sobre modelagem para impressão](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135) ressalta a necessidade de folga e a influência do material. A Formlabs oferece [calibração de encaixe](https://formlabs.com/support/Fit-Tuning-Form-4-and-Form-4L-generation/) por impressora e resina. Esses princípios fundamentam a calibração; a tabela acima não é atribuída a esses fabricantes.

## Como o corte funciona

A linha é um perfil aberto que avança da esquerda para a direita. Uma interpolação suave, sem ultrapassar a altura dos pontos, gera uma superfície que atravessa toda a peça na direção da vista. O volume é dividido com operações booleanas Manifold em um Worker, mantendo a interface responsiva. Curvas fechadas, laços, retornos horizontais e cortes de profundidade parcial não fazem parte desta versão.

A superfície permite separar as partes na direção vertical da vista de desenho. Os encaixes usam essa mesma direção, reduzindo o risco de um perfil que prenda uma parte na outra. As pontas da curva precisam cobrir a largura total do modelo. Importar um LYS é possível, mas a divisão gera somente STLs da peça, sem suportes/base ou redistribuição de suportes em LYS.

## Verificações

- A curva deve dividir o volume em duas partes válidas e não vazias.
- O macho e o alojamento devem encontrar as duas partes.
- Um volume de verificação aumentado pela parede mínima deve caber dentro do sólido original, inclusive no fundo. Falta de espaço provoca recusa com indicação do encaixe.
- Alojamentos sobrepostos são recusados; partes com interseção de volume também.
- Ilhas desconectadas são contadas e informadas na prévia, para revisão da orientação e suportes.
- Não há teto novo de triângulos ou tempo. Memória disponível e complexidade das operações continuam determinando a capacidade prática.

Essas verificações avaliam geometria, não resistência mecânica ou qualidade de impressão. A malha produzida deve ser conferida no fatiador.

## Arquitetura e testes

`src/organic.js`: perfis, conversão de coordenadas, curva, corte e encaixes, sem dependência da interface.

`src/organic-ui.js`: modo de desenho, edição, prévia separada, invalidação e downloads.

`src/geometry.worker.js`: executa divisão e exporta cada parte usando o mesmo sólido já preparado para os ímãs.

`tests/organic.test.js`: conservação de volume, três vistas, ausência de interseção, medidas das folgas, exportação/reimportação, paredes insuficientes, encaixes sobrepostos e curvas inválidas. Execute `npm test` e `npm run build`.

## Validação local em 14/10/2026

- 61 testes automatizados e build de produção concluídos.
- Navegador: desenho por arraste e por pontos; curva ondulada de cinco pontos; posicionamento de pino por clique na face; perfil de resina e troca para encaixe profundo de filamento; invalidação de downloads após alteração.
- As partes A e B exportadas no navegador foram reimportadas e aceitas como sólidos válidos (3.086 e 2.962 triângulos no ensaio de resina). Nenhum erro de console foi registrado.
- STL reparado da calça do Leonard com 1.693.720 triângulos: corte orgânico com folga entre faces de 0,10 mm, sem encaixes, em aproximadamente 2,43 segundos no teste Node local. O resultado contém quatro componentes na parte A e dois na B; portanto exige revisão das ilhas e do posicionamento da curva antes de imprimir. Esse modelo de terceiros não acompanha o código.

Os tempos são medições locais, não garantias de desempenho. Os testes validam geometria e fluxo de arquivos; ainda não houve ensaio físico desses encaixes em impressora de resina ou filamento.
