# MagnetLab no GitHub Pages

## Por que a publicação anterior não funcionou

O repositório estava configurado como **Deploy from a branch → main → /(root)**. Essa pasta contém o código-fonte do Vite, que precisa instalar as dependências e compilar JavaScript, estilos, Worker e WebAssembly antes da publicação. O GitHub Pages não executa automaticamente `npm run build` nesse modo.

Além disso, o site está em `/magnet-studio/`. A configuração anterior gerava endereços a partir de `/`, que apontavam para fora dessa pasta. O projeto agora usa `base: './'`, para gerar caminhos relativos também nos motores WASM e no Worker.

## Opção recomendada: GitHub Actions

Configuração necessária apenas uma vez:

1. No repositório **EtheoDev/magnet-studio**, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, selecione **GitHub Actions**.
3. Incorpore à `main` a correção de `vite.config.js`. Se estiver em um pull request, use **Merge pull request → Confirm merge**.
4. Na aba **Code**, escolha **Add file → Create new file**. Nomeie o arquivo `.github/workflows/pages.yml`, copie o conteúdo de **MagnetLab-pages.yml** entregue com a correção e confirme em **Commit changes**, na `main`. O envio automático desse arquivo foi bloqueado porque a autorização OAuth não inclui a permissão `workflow`; ele deve ser adicionado pelo proprietário no GitHub.
5. Abra a aba **Actions** e acompanhe **Publicar MagnetLab no GitHub Pages**.
6. Quando a execução terminar com sucesso, acesse **https://etheodev.github.io/magnet-studio/**.

Se o código já estiver na `main` antes de mudar a configuração, abra **Actions → Publicar MagnetLab no GitHub Pages → Run workflow**, selecione `main` e confirme. Isso inicia a publicação manualmente.

Nas próximas atualizações, basta enviar as alterações à `main`. O fluxo instala as dependências, executa os testes, compila a pasta `dist` e publica seus arquivos. O navegador continua processando os STLs localmente.

O arquivo entregue já contém o workflow completo; não é necessário escolher outro modelo no assistente do GitHub. Se ocorrer uma falha, abra a execução na aba Actions e veja qual etapa ficou vermelha.

## Alternativa: manter Deploy from a branch

Use uma branch separada para o site compilado, por exemplo `gh-pages`, para preservar o código-fonte na `main`.

1. Extraia o ZIP **MagnetLab-GitHub-Pages.zip** fornecido com esta correção.
2. Coloque o conteúdo extraído na raiz da branch escolhida para publicação. O `index.html` deve ficar diretamente na raiz, acompanhado de `assets/`, do símbolo e dos demais arquivos.
3. Inclua o arquivo vazio `.nojekyll`. Ele já está no ZIP, mas pode ficar oculto no gerenciador de arquivos. Se faltar, crie no GitHub um arquivo com esse nome contendo apenas uma linha em branco.
4. Em **Settings → Pages**, selecione **Deploy from a branch**, a branch de publicação e **/(root)**. Salve.

O ZIP contém o site pronto, sem STL do usuário. Envie os arquivos extraídos; enviar apenas o ZIP para o repositório não publica seu conteúdo.

A cada alteração do código, é preciso gerar uma nova compilação e atualizar a branch de publicação. Não basta editar o código-fonte na `main` nesse fluxo. Escolha somente uma das duas opções como fonte do Pages.

## Compilar novamente no computador

No diretório do projeto:

```sh
npm ci
npm test
npm run build
```

O resultado fica em `dist/`. Publicação por branch aceita a raiz ou a pasta `/docs`; não permite selecionar diretamente `/dist` nas configurações. Como este projeto já utiliza `docs/` para documentação, a branch separada evita sobrescrevê-la.

## Referências

- [GitHub: configurar a fonte de publicação](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Vite: publicação estática e GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)
- [Vite: caminhos relativos](https://vite.dev/guide/build.html#relative-base)
