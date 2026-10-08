# Publicar o MagnetLab gratuitamente

Verificado em 8 de outubro de 2026.

## Caminho mais simples: Cloudflare Pages

A aplicação é estática: os cálculos de STL e WebAssembly rodam no navegador do visitante. Não precisa de servidor de processamento nem banco de dados. O Cloudflare Pages oferece plano gratuito, sujeito aos limites do serviço. Um endereço `pages.dev` evita a compra de domínio.

1. Entre na sua conta em https://dash.cloudflare.com/ ou crie uma conta gratuita.
2. Abra **Workers & Pages** e escolha criar uma aplicação do **Pages** com envio direto de arquivos. Na documentação atual, o caminho é **Create application → Get started → Drag and drop your files**.
3. Escolha um nome disponível, por exemplo `magnetlab-edu`.
4. Envie o arquivo **MagnetLab-Publicar.zip** entregue com o projeto. Ele já contém o site compilado; não é necessário executar comandos.
5. Clique em **Deploy site** / **Save and Deploy**.
6. Abra o endereço `pages.dev` fornecido pelo serviço. Importe uma peça e confira o reparo e a exportação.

O nome exato do endereço depende da disponibilidade. Para atualizar, abra o mesmo projeto, escolha **Create a new deployment** e envie uma nova compilação. Não envie seus STLs: o pacote de publicação contém somente a aplicação.

Envio direto aceita ZIP ou pasta. O ZIP contém `index.html` na raiz, `assets/`, documentação, símbolo e licenças. O limite documentado para arrastar arquivos é 1.000 arquivos e 25 MiB por arquivo; esta versão fica abaixo desses limites. O limite de 25 MiB é para arquivos do site, não para o STL aberto localmente pelo visitante.

Fonte: [Cloudflare Pages — Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [limites](https://developers.cloudflare.com/pages/platform/limits/) e [plano gratuito](https://www.cloudflare.com/products/pages/).

## Atualizações automáticas pelo GitHub

Se preferir publicar automaticamente ao atualizar o código, crie desde o início um projeto Pages conectado a um repositório. Configure o comando de compilação `npm run build` e a pasta de saída `dist`. O projeto precisa de Node.js 22.12+ ou 24.

Um projeto Pages criado com envio direto não pode ser convertido para integração Git; é necessário criar outro projeto para esse fluxo. [Documentação oficial](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Gerar um novo pacote

No diretório do código-fonte:

```sh
npm ci
npm test
npm run build
```

Publique somente o conteúdo da pasta `dist`. A pasta do código-fonte inclui arquivos de desenvolvimento e não é o pacote de envio direto.

O processamento permanece local após a publicação. Quem visitar o site usa a memória e o processador do próprio dispositivo. A publicação não adiciona armazenamento de modelos, conta de usuário ou salvamento de projetos.
