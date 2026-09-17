# Agent Screen

Ferramenta local para agentes gravarem demonstrações de aplicações web com zoom animado, cursor suave e composição de vídeo. Primeira versão funcional: uma CLI, uma skill e um exemplo completo. A referência visual é o Screen Studio; este projeto não é afiliado a ele e ainda não oferece paridade com o editor.

## Experimentar

Requer Node.js 22+, FFmpeg no PATH e Chromium do Playwright.

```sh
npm ci
npx playwright install chromium
npm run demo
```

O exemplo abre uma aplicação fictícia local, edita o nome de um projeto e mostra o resultado. O MP4 fica em `recordings/demo/video.mp4`. Use uma pasta nova ao repetir a gravação:

```sh
node src/cli.mjs record examples/demo.json --out recordings/minha-demo
```

Instalar a skill no Codex:

```sh
node scripts/install-skill.mjs
```

O instalador cria um link para `skills/agent-screen` em `$CODEX_HOME/skills` (ou `~/.codex/skills`). A pasta deste projeto precisa permanecer disponível. Ele não substitui uma skill existente. A skill pode ser invocada como `$agent-screen` quando o ambiente recarregar a lista de skills.

## Roteiros para agentes

O agente inspeciona a aplicação, identifica os seletores e escreve um JSON como [examples/demo.json](examples/demo.json). A CLI executa o roteiro em um contexto Chromium isolado. Não usa outro modelo de IA, conta de serviço ou upload.

```json
{
  "url": "http://localhost:3000",
  "viewport": { "width": 1440, "height": 900 },
  "steps": [
    { "action": "click", "selector": "#edit", "pause": 1 },
    { "action": "type", "selector": "#title", "text": "Novo título" },
    { "action": "click", "selector": "#save", "expect": "#saved-message" },
    { "action": "focus", "selector": "#updated-title", "duration": 1.5 }
  ]
}
```

| Ação | Parâmetros | Comportamento |
| --- | --- | --- |
| `click` | `selector` | Move o cursor com aceleração e desaceleração e clica |
| `type` | `selector`, `text` | Foca o campo, seleciona tudo e digita com ritmo variável; evita reclicar no campo já focado |
| `focus` | `selector`, `duration` | Enquadra um elemento sem clicar; independe da posição do cursor |
| `scroll` | `y`, `duration` | Rolagem relativa em pixels com aceleração suave |
| `press` | `key` | Atalho ou tecla no elemento atualmente focado |
| `wait` | `duration` | Pausa em segundos |

Cada passo aceita `pause` (segundos após a ação) e `expect` (seletor que deve ficar visível). Sem `pause`, a captura escolhe um intervalo curto conforme a ação e a próxima etapa: cliques recebem mais respiro que focos e esperas, e resultados aguardados ficam visíveis por mais tempo. `expect` não verifica texto nem conclusão de requisições: selecione um indicador real de sucesso. Seletores ambíguos, elementos ausentes e expectativas não satisfeitas interrompem a gravação. O manifesto registra o erro e a exportação recusa sessões incompletas.

`file:./demo.html` é resolvido relativamente ao arquivo JSON. Para uma aplicação autenticada, `--storage-state /caminho/session.auth.json` carrega um estado Playwright existente. `--headed` abre o navegador com interface.

## Acabamento e exportação

```sh
# Capturar sem compor
node src/cli.mjs record roteiro.json --out recordings/entrega --capture-only

# Prévia leve
node src/cli.mjs render recordings/entrega --width 1280 --height 720

# Reexportar a mesma captura, sem repetir as ações
node src/cli.mjs render recordings/entrega --preset midnight --zoom 1.7 --blur 0.5
```

| Opção | Padrão | Faixa |
| --- | --- | --- |
| `--width`, `--height` | 1920 × 1080 | 320–3840, dimensões pares |
| `--fps` | 60 | 24–60, inteiro |
| `--zoom` | 1.8 | 1–3; 1 desliga o zoom |
| `--blur` | 0.65 | 0–1; 0 desliga motion blur |
| `--cursor-size` | 1.45 | 0.5–3 |
| `--padding` | 0.09 | 0–0.25 |
| `--preset` | macos | macos, dusk, midnight, pearl |
| `--pacing` | balanced | balanced, original |
| `--quality` | high | high (CRF 16), standard (CRF 18) |
| `--output` | `<gravação>/video.mp4` | Caminho alternativo de saída |

A câmera antecipa o foco em 550 ms e usa uma mola criticamente amortecida. A região de conforto impede que pequenos movimentos do cursor desloquem o enquadramento. O zoom adaptativo prefere até 1.35× para cliques, 1.5× para digitação e 1.3× para foco manual, sempre respeitando `--zoom` como limite. Um contêiner próximo e compacto é incluído automaticamente quando disponível; campos e regiões maiores reduzem a ampliação para caber com margem. Passos próximos mantêm o enquadramento aproximado; o encerramento volta à visão geral. `focus` permite enquadrar um contêiner maior para incluir contexto.

O cursor usa trajetórias Bézier determinísticas com variação por gesto, duração baseada na distância e no tamanho do alvo, aterrissagem levemente fora do centro e uma microcorreção lateral amortecida em deslocamentos longos. Um breve tempo de assentamento variável separa a chegada do clique. Isso preserva a repetibilidade do roteiro sem produzir movimentos idênticos e mecânicos. Os timestamps da trajetória são normalizados após a interação, evitando degraus quando o navegador atrasa uma amostra. Rotação discreta, compressão no clique e fade após inatividade completam o gesto. O cursor é composto separadamente da captura, com tamanho proporcional à cena e ao zoom. O motion blur integra amostras temporais do movimento da câmera e do cursor; ele não aplica um desfoque uniforme à tela. Novas capturas usam PNG sem perdas e `captureScale: 2`: viewport de 1440×900 produz frames de 2880×1800, sem mudar o layout da página. O Chromium usa escala física e emulada compatíveis, verificadas em cada frame. O zoom amostra a imagem original diretamente; evita reduzir a página antes de ampliá-la. Use `captureScale: 3` no roteiro para exportações 4K com mais reserva de resolução, respeitando o limite de 8192 pixels por dimensão.

O fundo padrão usa o wallpaper do macOS fornecido pelo usuário, salvo em `assets/macos-wallpaper.png`. A imagem preenche a saída sem distorção, com recorte central quando necessário. Os presets de gradiente continuam disponíveis. Wallpaper, margem, moldura, página e cursor formam uma única cena: na visão geral a margem aparece ao redor da tela e, durante o zoom, a cena inteira aumenta e se move continuamente com a câmera. O wallpaper pode continuar visível nas bordas quando o enquadramento pedir isso, evitando mudanças bruscas de posição durante a animação. A saída é H.264/MP4, com fast-start para reprodução na web.

## Arquivos de uma sessão

- `frames/*.png`: frames originais sem perdas em alta densidade; sessões antigas com JPEG continuam renderizáveis.
- `timeline.json`: timestamps, posições do cursor, cliques, regiões de foco e status.
- `video.mp4`: vídeo composto.
- `poster.png`: frame do meio da exportação para inspeção rápida.
- `camera.json`: trajetória da câmera para diagnóstico.
- `render.json`: parâmetros e medições reais de tempo de exportação e memória amostrada do processo Node.

O arquivo do vídeo só é substituído após uma exportação bem-sucedida. Re-renderizar pode alterar o vídeo e os arquivos de diagnóstico da sessão. O roteiro contém os textos digitados; o manifesto não os duplica, mas os frames naturalmente mostram o conteúdo visível da página.

## Arquitetura e dependências

```text
Roteiro do agente → Playwright / Chromium → PNGs + eventos com timestamps
                                              ↓
                              Câmera + composição Skia → FFmpeg → MP4
```

O código é separado pela responsabilidade de cada etapa:

```text
src/
├── cli.mjs                 entrada da CLI
├── cli/options.mjs         parsing e normalização de flags
├── capture/
│   ├── record.mjs          orquestra a sessão de gravação
│   ├── actions.mjs         executa passos e movimento do cursor
│   ├── pacing.mjs          tempos de pausas, deslocamento e digitação
│   ├── page-state.mjs      inspeção do DOM e estabilização da rolagem
│   └── screencast.mjs      captura, verifica resolução e persiste frames do CDP
├── render/
│   ├── index.mjs           orquestra a exportação frame a frame
│   ├── background.mjs      wallpaper, gradientes e moldura
│   ├── scene.mjs           composição direta da fonte e transformação da cena
│   ├── cursor-art.mjs      vetores do cursor e indicador do clique
│   ├── cursor.mjs          visibilidade e transições de tipo
│   ├── focus.mjs           agrupamento, antecipação e liberação dos focos
│   ├── pacing.mjs          compressão temporal de esperas com rampas suaves
│   ├── encoder.mjs         processo e lifecycle do FFmpeg
│   └── settings.mjs        defaults e validação de render
├── motion.mjs              câmera, easing e trajetória do cursor
└── plan.mjs                validação do roteiro
```

`src/record.mjs` e `src/render.mjs` continuam como fachadas públicas para manter imports existentes estáveis.

- [Playwright](https://playwright.dev/): ações, seletores e controle do Chromium.
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast): frames com timestamp do compositor, sem polling de screenshots para o vídeo.
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas): composição nativa com Skia.
- [FFmpeg](https://ffmpeg.org/): codificação H.264 e mux do MP4.

A captura e a renderização são sequenciais e independentes. O renderizador mantém somente o frame fonte atual e buffers de composição, aplica amostragem adaptativa e respeita a vazão do encoder. Os metadados de câmera são proporcionais à duração; os frames originais ficam em disco. A memória reportada não inclui processos Chromium nem FFmpeg.

Referências analisadas: [Screen Studio — animações](https://screen.studio/guide/animations), [cursor](https://screen.studio/guide/cursor), [auto zoom](https://screen.studio/guide/auto-zoom), [Recordly](https://github.com/webadderallorg/Recordly) e [OpenScreen](https://github.com/siddharthvaddem/openscreen). Os dois últimos são aplicações de edição completas; nenhum código ou asset deles foi incorporado. A implementação utiliza as bibliotecas listadas acima e mantém a lógica específica de roteiro e enquadramento neste projeto.

## Limites desta versão

- Grava roteiros executados pela própria CLI em uma única aba Chromium; não grava o histórico do trabalho nem se conecta à aba que outro agente já está usando.
- A câmera e o cursor são renderizados a 60 fps por padrão. A captura da interface segue o ritmo do compositor do navegador; 60 fps na saída não garante 60 frames distintos da aplicação por segundo.
- Sem captura de áudio, webcam, janelas nativas, popups, drag-and-drop ou edição visual de timeline.
- A rolagem da página é capturada como ocorre; o blur temporal implementado trata câmera e cursor, sem sintetizar frames intermediários da interface.
- Alterar a proporção da saída mantém a proporção da captura e adiciona margem; ainda não há recomposição automática para redes sociais verticais.
- Usa Skia e libx264 em CPU. Aceleração GPU e encoder de hardware ainda precisam de implementação e benchmark.
- Novas capturas registram seta, mão e I-beam conforme o DOM, com transições de 80 ms. Não há captura de cursores personalizados de canvas/iframes; sessões antigas usam seta.

## Verificação

```sh
npm test
npm run check
```

Os testes cobrem geometria e estabilidade da câmera, trajetória e interpolação do cursor e validação do roteiro. O exemplo local exercita captura, digitação, cliques, resultado final, composição e codificação. A revisão visual do MP4 continua necessária: esses testes não medem beleza nem demonstram equivalência ao Screen Studio.


## Caminho rápido para agentes

A skill reaproveita URL, seletores e estado conhecidos da tarefa. A preparação deve investigar apenas o que falta para o roteiro; não exige auditoria do projeto, reinstalação, ensaio completo ou exportação de prévia. O comando `record` já verifica as dependências antes das ações e entrega o MP4 numa única execução. O padrão continua 1080p/60 fps.

```sh
# Diagnóstico opcional: informa o repositório da ferramenta e correções necessárias
node src/cli.mjs doctor
# Validação opcional, sem navegador; não verifica seletores na aplicação
node src/cli.mjs validate examples/demo.json
```

Help e validação carregam apenas módulos necessários e funcionam sem Canvas, Chromium ou FFmpeg instalados. Instale dependências no repositório da ferramenta, nunca no projeto filmado por engano. O runner da skill funciona a partir de outro diretório usando caminhos absolutos.

`workflow.json` registra preflight, setup do navegador, gravação, exportação e total da CLI. Setup é parte do tempo de gravação, não deve ser somado novamente. A preparação do agente antes da chamada não é medida. Os tempos da CLI aparecem também no JSON final. Falhas de exportação indicam como reaproveitar a captura com `render`.

A câmera intersecta regiões de foco com o viewport antes de calcular o zoom. Contêineres maiores que a área visível são centralizados quando não cabem na região de conforto. A posição animada usa o espaço disponível no zoom atual, sem cortar a posição depois da mola; isso evita saltos ao sair de um close-up nas bordas. Essa correção também se aplica a capturas existentes via `render`.

Após um clique sem atividade, o zoom começa a voltar à visão geral em 2,4 segundos, mesmo se a aplicação ainda estiver carregando. Movimento do cursor renova esse intervalo; digitação registrada mantém o foco até terminar. `focus` manual respeita sua duração. Em capturas antigas, o fim real da digitação pode não estar separado da espera por resultado.

O cursor usa interpolação cúbica monotônica entre amostras: preserva posições e horários de clique sem overshoot nem atraso de um filtro. Novas capturas usam arcos menores. A seta mantém tamanho constante na saída durante o zoom; inclinação e compressão do clique são discretas e suavizadas.



## Demonstração longa

`examples/extended-demo.html` é um workspace fictício local com formulário, menus, checklist, notas, gráfico e relatório. `examples/extended-demo.json` executa 38 ações, incluindo rolagem, foco em regiões amplas, teclas, digitação longa e carregamentos simulados. Não acessa serviços externos.

```sh
node src/cli.mjs record examples/extended-demo.json --out recordings/extended-demo
```

Use uma pasta nova ao repetir. Os carregamentos deliberados permitem avaliar o recuo do zoom após inatividade; as regiões amplas exercitam legibilidade e redução automática de ampliação.

## Qualidade atual (2026-09-15)

O padrão `high` usa fonte PNG em 2×, composição direta, até oito amostras temporais e H.264 CRF 16. A conversão usa matriz BT.709 com transferência sRGB identificada no arquivo. `standard` usa CRF 18 e até cinco amostras, preservando a fonte capturada. O render informa a resolução fonte e a reserva de pixels no maior zoom; valores abaixo de 1 significam ampliação de pixels existentes.

Grupos compactos compartilham escala e região de enquadramento. Scrolls encerram focos antigos e a câmera abre antes da rolagem; a próxima aproximação aguarda o alvo estar disponível. A rolagem agenda eventos conforme o tempo real e descarta atrasos, mantendo a duração solicitada. A digitação varia nos limites de palavras e pontuação. O indicador do clique fica preso ao ponto clicado.

Esperas longas usam rampas contínuas de velocidade, limitadas a 4×, mantendo 550 ms em velocidade real nas bordas. Movimentos, cliques e scrolls protegidos não são comprimidos. `pause` e `focus` explícitos continuam disponíveis para leitura. [Mapa das melhorias, referências e limites](docs/quality-review.md).

As revisões anteriores estão no [histórico técnico](docs/history.md).
