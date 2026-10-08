# Bibliotecas de terceiros

Este projeto usa as seguintes bibliotecas. Consulte os arquivos de licença distribuídos em cada pacote e mantenha seus avisos quando redistribuir a aplicação.

| Pacote | Versão | Licença | Fonte |
|---|---|---|---|
| three | 0.180.0 | MIT | https://github.com/mrdoob/three.js |
| three-mesh-bvh | 0.9.1 | MIT | https://github.com/gkjohnson/three-mesh-bvh |
| manifold-3d | 3.2.1 | Apache-2.0 | https://github.com/elalish/manifold |
| lucide | 0.468.0 | ISC | https://github.com/lucide-icons/lucide |
| meshfix-wasm | 0.6.1 | MIT (inclui PMP Library, MIT) | https://github.com/anthonygreco/meshfix-wasm |
| vite | 7.3.7 | MIT | https://github.com/vitejs/vite |

Fontes da interface: DM Sans e Manrope, disponibilizadas por Google Fonts. A aplicação mantém fontes alternativas do sistema se elas não carregarem.

O motor de reparo usa o módulo WASM do pacote meshfix-wasm, sem alterações, e uma integração própria em src/repair-advanced.js. Sua licença está disponível em public/licenses/meshfix-wasm-MIT.txt. PMP Library: https://github.com/pmp-library/pmp-library.
