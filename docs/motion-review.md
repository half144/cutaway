# Revisão de movimento e acabamento — 26/09/2026

Objetivo: vídeos com o acabamento do Screen Studio, em que o cursor, o ritmo e a câmera pareçam de um apresentador tranquilo e não de um script. Os valores abaixo vêm de três fontes: a documentação e os demos do Screen Studio, o código de editores open-source que declaram imitar a mesma semântica, e pesquisa de controle motor e digitação. Nenhum código ou asset foi copiado.

## Diagnóstico da versão anterior (medido)

Medições feitas na timeline de `extended-demo-20260915-retina` (38 passos), usando a mesma lógica de câmera:

- **Pumping:** o zoom saía e voltava em menos de 1,8 s em 6 momentos, e 3 retornos à visão geral duravam 0,4–0,8 s. A causa era o `scrollIntoView({ block: 'nearest' })`, que deixava cada alvo colado na borda e forçava um novo scroll a cada passo, somado a uma ponte de apenas 1 s entre focos.
- **Auto-scroll:** o scroll nativo `smooth` do Chromium durava 0,32–0,38 s (√Δ/60) e foi capturado em 4–8 frames.
- **Zoom ausente:** 7 de 30 focos terminavam em 1,0×, incluindo 6,5 s de digitação num textarea de 1029 px e 6 de 10 `focus` manuais.
- **Limite da câmera:** era calculado em unidades do viewport, o que tirava curso para centralizar o alvo. Nos close-ups junto à borda sobravam ~250 px de wallpaper (13% do quadro) enquanto o conteúdo útil era cortado do outro lado.
- **Clique invisível:** o anel branco com 22% de opacidade não aparecia em páginas claras.
- **Cursor sobre o texto:** o I-beam ficava em cima do texto sendo digitado.
- **Digitação rápida demais:** 10–12,7 caracteres/s (~150 WPM).
- **Render lento:** 4,1 fps em 1080p. Cada amostra de motion blur refazia o resample da captura de 5 MP (39 ms em `high`, 11 ms em `medium`).

## Referências

- **Screen Studio.** O demo de cursor do site, que segundo o autor se comporta como o app nas configurações padrão, usa mola 470/70/3, clique a 0,8×, rotação de vx/240 graus e troca de forma com escala de 0,6 para 1 em 0,2 s. No vídeo oficial de auto-zoom, o zoom sai de forma abrupta, fica quase completo em 0,6–0,7 s e mostra o wallpaper perto das bordas. Atalhos aparecem numa pílula escura e teclas isoladas ficam ocultas por padrão ([guia de atalhos](https://screen.studio/guide/shortcuts), [animações](https://screen.studio/guide/animations)).
- **Cap** (`crates/rendering`, que cita a semântica do Screen Studio). Auto-zoom de 2×, começando 300 ms antes do clique, segurando 2,5 s depois e juntando intervalos com até 2,5 s de distância. O cursor encolhe para 0,8 ao longo de 130 ms antes do clique. O fade de ocioso leva 400 ms, com o cursor reaparecendo 250 ms antes de o movimento voltar.
- **openscreen e Recordly.** A curva `easeOutScreenStudio = cubic-bezier(0.16, 1, 0.3, 1)`, zoom padrão de 1,8×, e pan em vez de zoom-out quando o intervalo é menor que ~1,5 s.
- **Controle motor.** Lei de Fitts para mouse com a ≈ 0,1 s e b ≈ 0,2 s/bit ([Buxton](https://www.billbuxton.com/fitts91.html), [Soukoreff e MacKenzie](https://www.yorku.ca/mack/ijhcs2004.pdf)). A fase de desaceleração ocupa 55–70% do tempo. O movimento principal para em ~94% do caminho e é completado por uma correção. O desvio lateral típico fica em ~3% da distância ([MacKenzie et al. 2001](https://www.yorku.ca/mack/CHI01.htm)). O botão fica pressionado por 100–120 ms.
- **Digitação e leitura.** Digitadores rápidos têm intervalo entre teclas de ~120 ms e a primeira tecla de cada palavra é mais lenta ([Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)). Em legendas, a leitura confortável fica em 0,3–0,375 s por palavra ([BBC](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/)).

## Decisões

| Aspecto | Antes | Agora | Por quê |
| --- | --- | --- | --- |
| Zoom | Janela por foco; nível 1,45–1,75× conforme a ação | Tomadas: ações a até 3,5 s juntas, nível constante de 1,8×, 2,5 s após o clique, conexão por pan em intervalos < 2 s, descarte de tomadas < 0,9 s | Segue a semântica do Cap e do Screen Studio; nível constante evita o zoom "respirando" |
| Zoom com propósito | Close-up contínuo em qualquer sequência de ações (86% do demo do dashboard com zoom, 80% a ≥ 1,6×), nível 1,8×, 2,5 s após o clique | A captura registra a área que mudou após cada clique; se o efeito ocupa a tela, o clique acontece na visão geral. Nível padrão 1,5×; zoom mantido 1,8 s após o clique e 1,2 s após a digitação; junção até 3 s; conexão < 1,5 s | O usuário achou o zoom forte e longo demais. No dashboard: 48% com zoom, pico 1,5×, menor retorno à visão geral 2,8 s (antes 1,4 s) |
| Ritmo | Movimentos 0,16 + 0,17·ID; espera de animações até 0,9 s; pausas fixas; leitura de 0,3 s por palavra até 2,4 s; digitação ~100 WPM | Movimentos 0,12 + 0,14·ID (piso D/1100 s); espera até 0,6 s; pausas com variação de ±30%; leitura de 0,6 s + 0,15 s por palavra até 1,6 s; ~110 WPM | O usuário achou algumas ações lentas e o ritmo robótico. No dashboard: movimento médio de 0,80 para 0,68 s; ação média de 2,34 para 2,11 s; maior pausa de 2,4 para 1,6 s |
| Abertura | Um `focus` no início dava zoom sozinho aos ~1 s, antes de qualquer ação | O vídeo abre na página inteira; um `focus` antes do primeiro gesto é ignorado e o primeiro zoom começa com o primeiro movimento do mouse | Zoom sem causa visível no começo parecia aleatório |
| Sincronia câmera e cursor | Câmera agendada pela chegada do cursor (0,4 s antes); acompanhamento só a partir de 84% da vista | A câmera parte junto com o cursor e o acompanha nos 60% centrais; o zoom-out que termina até 1 s antes de uma saída do cursor passa a acontecer junto com ela | No demo longo, o cursor parado era arrastado em média 153 px (e saía do quadro em 5 gestos). Agora são 78 px. As mudanças de enquadramento pedidas pelo roteiro escondem o cursor parado (veja a segunda passada) |
| Mola da câmera | Uma mola crítica de ω = 5,8 (tranco inicial, 90% em 0,67 s) | Cascata ω = 30 e 7,2 em escala logarítmica, sub-passos de 1/240 s | Mesma curva de saída do vídeo oficial (90% em ~0,6 s, cauda até ~1,2 s), sem o salto de aceleração no primeiro frame |
| Enquadramento | Limite em unidades do viewport | Limite na cena com margem; wallpaper limitado ao padding e a ~10% da vista; pré-mira em 1× e zoom-out a partir do mesmo enquadramento | Comportamento do Screen Studio, com curso suficiente para centralizar o alvo |
| Resultados | `expect` só esperava o elemento | Enquadra o resultado junto do controle, vai até ele, ou mostra na visão geral se for grande | A câmera vai aonde a mudança acontece |
| Campos largos | Sem zoom | Enquadra o início do campo e segue o caret | Digitação é onde o zoom mais importa |
| `focus` alto ou largo | Ignorado | Alto: ajustado pela largura e lido a partir do topo. Largo demais: segura a visão geral durante o foco, sem tomadas por cima | Seis de dez focos do demo não faziam nada |
| Auto-scroll | `scrollIntoView` nativo, alvo na borda | Deslizamento próprio (0,45 s + √Δ/45 s), alvo a 45% da altura (alvos altos: a partir do topo), junto com o próximo alvo quando cabe; elementos fixos não rolam a página | Menos scrolls, sem saltos, alvo com contexto |
| Trajetória | Bézier com lado aleatório, pico em 50%, desvio lateral no fim | Arco consistente (3–6%), pico em ~42%, pouso a ~96% e correção ao longo do trajeto | Movimento de mira humano, sem as oscilações das bibliotecas anti-bot |
| Duração do movimento | 0,18 + 0,16·ID | 0,16 + 0,17·ID, com piso de D/850 s | Fitts de apresentador; pico de velocidade legível |
| Clique | Anel branco; botão pressionado 70 ms | Encolhe para 0,8× antes do mouse-down; botão pressionado 95–125 ms; sem anel | Padrão do Screen Studio e do Cap; funciona em qualquer fundo |
| Cursor | 1,45; troca de forma em 80 ms; visível durante a digitação | 2,0 e cresce com √zoom; crossfade com escala de 0,2 s; some ao digitar; rotação de vx/240 graus | Tamanho e comportamento do Screen Studio e do macOS |
| Digitação | ~150 WPM com ciclo pseudoaleatório | Lognormal ~100 WPM, primeira tecla da palavra ×1,35, +260 ms após vírgula e +480 ms após ponto | Rápido demais parece autocompletar |
| Ritmo | Pausas fixas de 0,3–0,55 s | Espera animações e mudanças do DOM (≤ 0,9 s) antes da pausa; `expect` em tela por 0,5 s + 0,3 s por palavra; abertura de 0,9 s | Tempo de leitura de legendas |
| Composição | Moldura lisa; viewport 16:10 | Barra de navegador vetorial, sombra em três camadas, borda fina; viewport padrão 1440×810 | Parece uma janela real, com margens uniformes em 16:9 |
| Teclas | Invisíveis | Pílula com combinações de modificadores (`--keys`) | Atalhos sem causa visível confundem |
| Render | Resample completo por amostra de blur; overlay em tela cheia | Um raster por frame, amostras por transformação afim, composição só na área do cursor | 11,9 fps em 1080p (antes 4,1–4,6) |

## Segunda passada: acabamento do vídeo (medido)

Medições nas capturas `polish-20260926-final` (38 passos, 123 s) e `polish-20260926-demo` (13 s), com a câmera e o cursor simulados exatamente como no render e os pixels comparados numericamente. Nenhum frame foi avaliado a olho.

| Aspecto | Antes | Agora | Medição (antes → agora) |
| --- | --- | --- | --- |
| Cursor parado arrastado pela câmera | Um `focus` logo após um clique ou o zoom-out de um resultado grande levava o cursor parado pela tela, às vezes para fora do quadro | A câmera é simulada antes do cursor. Quando um movimento que começa com a mão parada levaria o cursor mais de 1/16 da largura do quadro (120 px em 1080p) ou para fora dele, o cursor encolhe e some 0,1 s antes e volta 250 ms antes de a mão se mover, como no Cap. A acomodação da câmera logo após um gesto continua visível | Arrasto visível total: 2988 → 510 px (longo) e 1862 → 68 px (curto). Pior episódio: 1127 → 151 px e 1857 → 63 px. Cursor visível levado para fora do quadro: 1,88 → 0 s e 1,33 → 0 s. Nos 21 cliques, o cursor continua 100% visível |
| Aparecer e sumir | Suavização exponencial reativa: 28% da opacidade some no primeiro frame; ocioso aos 2,5 s mesmo que a mão fosse se mover 0,1 s depois | Intervalos calculados com antecedência e fades com easing (0,18 s para sumir, 0,2 s para voltar). Ocultações com menos de 0,5 s são puladas. Um cursor que sumiria antes do primeiro movimento não aparece na abertura | Maior variação por frame: 0,283 → 0,138. Piscadas (sumir e voltar em < 0,8 s): 1 → 0 |
| Resultado revelado e `focus` nele | 1,8× → visão geral por 2,1 s → 1,18× no mesmo conteúdo (71–73 s) | Se a próxima tomada começa até 3,5 s depois e mostra ao menos metade do resultado revelado, a câmera vai direto do close-up para ela | Idas e voltas ao zoom 1× (queda > 0,3 seguida de nova aproximação em até 3 s): 3 → 2. As duas restantes são intencionais: um passo `wait` e um `focus` grande demais para ampliar |
| Final do vídeo | Duração = soltura da última tomada + 1,1 s; o zoom-out leva ~1,5 s para assentar | Soltura + 1,5 s para assentar + 1 s parado na visão geral | Tempo parado no fim (câmera < 2 px/s): 0,45 → 0,98 s e 0,43 → 0,98 s. No MP4 decodificado: 0,52 → 1,05 s e 0,48 → 1,03 s. A abertura já tinha ~1 s sem nenhuma mudança de pixel e os dois primeiros frames capturados são idênticos |
| Motion blur | Até 8 amostras; o zoom era medido como Δzoom × largura, o dobro do deslocamento real | Até 16 amostras, espaçadas em no máximo ~2 px, com o deslocamento real (pan + alcance do zoom nos cantos) | Frames com amostras a mais de 2 px: 427 → 42. Maior espaçamento: 4,45 → 2,23 px. Nos três trechos mais rápidos medidos, o PSNR nas bordas frente a 48 amostras subiu de 34,6–38,1 para 39,5–40,3 dB. Custo: +8,5% de amostras; num trecho de 32 s só com pans rápidos, o render ficou ~8% mais lento (média de 4 execuções) |
| Cores | O arquivo saía como 2-2-1 (primárias e transferência "não especificadas"), sem átomo `colr`. O QuickTime interpreta isso como BT.709 e mostra a captura mais clara | Tags 1-13-1 (primárias e matriz BT.709, transferência sRGB, faixa limitada) gravadas com `setparams` no VUI do H.264 e no átomo `colr nclx` | Erro em áreas lisas após decodificar com BT.709 limitado: 0,355 nível (média), igual ao piso da conversão YUV 4:2:0 sem compressão (0,343). Veja abaixo |

**Cores.** A captura do Chromium é sRGB. O AVFoundation decodifica BT.709 e vídeo sem tag com gama ≈ 1,96: um cinza sRGB 126 aparece como 137. Com a transferência 13 (IEC 61966-2-1), ele usa a curva sRGB e mostra 126 ([Apple TN2227](https://developer.apple.com/library/archive/technotes/tn2227/_index.html), [kCVImageBufferTransferFunction_sRGB](https://developer.apple.com/documentation/corevideo/kcvimagebuffertransferfunction_srgb), [análise do gamma shift do QuickTime](https://blog.dominey.photography/2021/01/24/why-are-videos-washed-out-on-the-mac-exploring-quicktime-gamma-shift/)). O Chrome aplica a curva sRGB tanto para BT.709 quanto para sRGB ([color_space.cc](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gfx/color_space.cc)). O Firefox trata BT.709 como sRGB por padrão (`gfx.color_management.rec709_gamma_as_srgb`, [StaticPrefList](https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml)). As diretrizes da ASWF recomendam `iec61966-2-1` como a opção mais confiável para web e desaconselham gama 2.2 no Safari ([Web Color Preservation](https://academysoftwarefoundation.github.io/EncodingGuidelines/WebColorPreservation.html)). O código dos valores está na [ITU-T H.273](https://www.itu.int/rec/T-REC-H.273). O encoder já passava `-color_trc iec61966-2-1`, mas desde o FFmpeg 7.1 as tags vêm dos frames filtrados e essas opções são descartadas ([commit 9a7686e](https://github.com/FFmpeg/FFmpeg/commit/9a7686e5458dad8d40b3b3f70f6a19530933468e)). Por isso o filtro [`setparams`](https://ffmpeg.org/ffmpeg-filters.html#setparams) as grava. Com as três tags definidas, o muxer MP4 escreve o `colr` sozinho. Um teste agora confere as tags e as cores decodificadas.

A conversão RGB → YUV do encoder confere com a fórmula BT.709 para branco, preto, cinza e cores da interface. Uma armadilha de medição: a conversão YUV → RGB padrão do swscale arredonda para baixo (o branco vira 253). Para medir cores, decodifique com `flags=accurate_rnd+full_chroma_int`.

**Codificação.** SSIM, PSNR e nitidez de bordas (PSNR só nos pixels de texto e fração do gradiente preservada) foram medidos em 594 frames: digitação a 1,8×, pan rápido, visão geral com texto pequeno e zoom-out. A referência são os frames compostos sem perdas, convertidos para YUV 4:2:0 da mesma forma:

| Configuração | PSNR-Y (dB) | SSIM-Y | PSNR bordas (dB) | kbps |
| --- | --- | --- | --- | --- |
| medium, CRF 16 (padrão) | 53,06 | 0,99854 | 40,63 | 1571 |
| slow, CRF 16 | 53,25 | 0,99863 | 40,79 | 1587 |
| medium, CRF 14 | 54,65 | 0,99896 | 42,30 | 1963 |
| medium, CRF 16, `aq-mode=3` | 54,68 | 0,99878 | 42,78 | 2012 |
| medium, CRF 16, `-tune animation` | 53,30 | 0,99831 | 41,36 | 1576 |
| medium, CRF 16, `-tune stillimage` | 51,90 | 0,99840 | 39,11 | 2118 |
| medium, CRF 16, `deblock=-1,-1` | 53,02 | 0,99853 | 40,64 | 1567 |
| medium, CRF 12 | 56,31 | 0,99928 | 43,97 | 2466 |

O padrão continua: o pior frame fica em 46,9 dB e a mediana em 53,4 dB, já na faixa transparente. `slow` ganha 0,2 dB e custa ~35% mais CPU. CRF 14 e `aq-mode=3` ganham ~1,6 dB com 25–28% a mais de arquivo; no mesmo bitrate, `aq-mode=3` rende o mesmo que o CRF 14. `stillimage` piora as bordas. `animation` troca SSIM por PSNR de borda. Em RGB, com o croma incluído, as bordas ficam em 36,0 dB, contra 40,1 dB do 4:2:0 sem compressão: `chroma-qp-offset=-4` sobe 0,4 dB com 6% a mais de arquivo, e CRF 14 sobe 0,9 dB com 25%. Nenhuma dessas trocas justificou mudar o padrão. O 4:4:4 ficou de fora por compatibilidade: o perfil High 4:4:4 do H.264 não tem suporte garantido no QuickTime e no Safari.

**Rejeitado.** Compensar o scroll entre frames capturados usando o `scrollOffsetY` do CDP. Sem as camadas separadas, elementos fixos ou sticky deslocariam junto com a página; a captura determinística continua sendo o caminho seguro. Também foi rejeitado baixar o limite de arrasto para esconder o cursor em todo zoom-out: a acomodação logo após um gesto chega a 54 px e deve continuar visível, como no Screen Studio.

## Limites

- **Cadência da captura:** continua sendo o limite principal. O screencast CDP entrega ~25–40 fps durante o scroll, independentemente de PNG ou JPEG e de quando o ack é enviado, e a exportação a 60 fps não cria frames da página. Uma captura determinística com BeginFrame e tempo virtual resolveria, mas exige reescrever a captura. `render.json` mostra `sourceFpsDuringScroll`.
- **Gravações antigas:** reexportar aplica câmera, cursor, clique e composição. Caret, resultados do `expect`, teclas, digitação e auto-scroll novos só existem em capturas novas.
- **Escopo dos testes:** os testes garantem continuidade, limites e tempos; não substituem assistir ao vídeo.

## Terceira passada: ritmo humano (26/09)

Um agente assistiu aos vídeos quadro a quadro, mediu o que parecia robótico e comparou com Cap, Screenize, Recordly, capptivo e os forks do openscreen (código em `/tmp/as-oss`). Medições no demo do dashboard (`web-dashboard`), v2 → v3:

| Problema observado | Mudança | Resultado medido |
| --- | --- | --- |
| Cursor congelado 69% do tempo visível; todo gesto era "parado → traço → parado" | Mão relaxa 8–16 px dentro do controle após o clique; nas pausas, parte devagar (≤ 250 px/s) para o próximo alvo visível; leve deslize em repousos longos. Nenhum tremor aleatório (ghost-cursor faz isso para evitar detecção de bot, errado para demo) | Congelado 69% → 58%; maior trecho 3,7 → 1,7 s (o restante é o auto-scroll, em que uma pessoa também mantém o mouse parado) |
| Micro-tempos de metrônomo (chegada → clique 0,14–0,21 s; clique → tecla sempre 0,25 s) | Espera antes do clique lognormal (mediana 0,12 s), +0,05 s por bit acima de 3, +0,15 s antes de salvar/excluir/confirmar; botão lognormal ~105 ms; mão até o teclado 0,25–0,45 s; campo selecionado por ~0,2 s e sobrescrito; digitação lognormal (mediana 90 ms, σ 0,42), ×1,5 no início da palavra, 4% de hesitações | Clique → tecla 0,29 s (CV 8%) → 0,47 s (CV 20%) |
| Tempo morto: painel aberto 1,6 s parado, cauda de 3,5 s, 28% de trechos estáticos no demo longo | Compressão de trechos estáticos > 1,1 s (0,35 s de borda, meio 3,5×), ignorando repaints imperceptíveis (limiar em miniatura 192×108); leitura pelo título do resultado; pausa curta quando o próximo passo age dentro do resultado; final 1,2 + 0,4 s | Trechos estáticos ≥ 0,8 s: 32% → 15% do vídeo |
| Câmera ~0,4 s atrasada em relação ao mouse após uma visão geral | A visão geral de um efeito grande termina quando a mão parte de novo | Atraso 0 s em todas as tomadas |
| Movimentos de câmera todos com a mesma duração | A mola principal varia 0,8–1,5× conforme o tempo até a próxima mudança (Screenize, `AdaptiveResponse.swift`) | Durações variadas; o zoom-out final mantém o ritmo normal para o vídeo terminar parado |
| Vai e volta de zoom entre close-ups próximos | Entre close-ups até 2,5 s separados em assuntos próximos, recua até a metade (Screenize `WaypointGenerator.swift`) | Sem retorno a 1× seguido de novo zoom em < 2,5 s |
| Inclinação no limite de 10° em todo traço longo | 1° por 480 px/s, até 8° (Cap dá ~4,5°) | — |
| Aperto do clique longo quando a página está ocupada | Aperto limitado a 0,14 s e soltura com leve rebote (1,04×) | — |
| Cursor sumindo por até 12 s; Esc limpando o campo sem causa visível | Some só após 3,5 s parado, nunca durante scroll; teclas não escondem o cursor; Esc/Enter/Tab aparecem na pílula | — |
| Abertura com animação de entrada e tooltip sob o cursor | Espera a página parar (até 3 s, 0,4 s de silêncio) e estaciona o cursor num ponto sem hover | Primeiros frames idênticos (Δ 0,02) |
| Traço lento no fim ("creep") | Correção final só para alvos < 24 px, ≤ 120 ms | Cauda lenta ≤ 0,16 s em alvos grandes |

Revisto a pedido do usuário ("o movimento do mouse não está natural"): o deslize após o clique e o avanço lento durante a pausa viravam um tique mecânico e um movimento em duas etapas (desliza, para, avança, para, traço). Foram trocados por um único traço até o próximo alvo durante a pausa, com a mão esperando sobre ele; a câmera parte com esse traço (`approachStart`). No dashboard: nenhum movimento < 40 px e nenhum traço emendado em outro.

Revisto de novo ("movimento muito linear, não está suave"): os traços desviavam só 1,4–2,6% da linha reta e o cursor era desenhado exatamente sobre o traço. Agora o arco chega a 4–7% da distância, e o cursor passa pela mola do Screen Studio (470/70/3, perseguindo um ponto 60 ms à frente) e fica preso ao ponto exato em cada clique. No dashboard: arcos de 3,7–6,1%, aceleração brusca do cursor em 65% da do traço cru, cliques a 0,0 px do alvo. Se o layout muda depois de um traço feito na pausa, o clique acontece onde a mão está, sem segundo traço de correção.

Rejeitado: o plano médio (1,25×) para efeitos grandes sugerido pelo revisor deixou o vídeo com zoom em 86% do tempo, contra o pedido do usuário por menos zoom; foi removido.
