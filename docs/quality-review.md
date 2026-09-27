# Revisão de qualidade — 15/09/2026

Câmera, cursor, clique, digitação e composição foram revistos em 26/09; veja a [revisão de movimento e acabamento](motion-review.md). As decisões de captura e resolução abaixo continuam valendo.

O objetivo é melhorar legibilidade, continuidade e ritmo em demonstrações web. As mudanças abaixo estão implementadas. Não houve cópia de código ou assets das aplicações de referência; os cursores vetoriais desta versão são próprios.

## Referências consultadas

- [Screen Studio: animações](https://screen.studio/guide/animations) separa ajustes de cursor, zoom e pan e oferece animação que se estabiliza para facilitar leitura.
- [Screen Studio: cursor](https://screen.studio/guide/cursor) documenta formas, ocultação durante inatividade, rotação e redução de trocas rápidas de tipo.
- [Recordly: constantes](https://github.com/WizardofTryout/recordly/blob/main/src/components/video-editor/videoPlayback/constants.ts) e [ligação de zooms](https://github.com/WizardofTryout/recordly/blob/main/src/components/video-editor/videoPlayback/zoomRegionUtils.ts) usam intervalos de transição e conexão de regiões. A leitura informa o projeto; os tempos não foram copiados como novo preset.
- [Cap: planejamento da câmera](https://github.com/CapSoftware/Cap/blob/main/crates/rendering/src/zoom_spring.rs) considera coordenadas do conteúdo, zonas de conforto e testes para movimentos abruptos de automação.
- [Chromium: PageHandler](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/page_handler.cc) captura a superfície física do compositor. Alterar apenas o DPR emulado não garante screencast Retina. Isso foi reproduzido e verificado nesta máquina.
- [FFmpeg: scale](https://ffmpeg.org/ffmpeg-filters.html#scale-1) permite controlar matriz e faixa na conversão RGB → YUV. O arquivo agora identifica também primárias e transferência.

## Gaps corrigidos

| Gap identificado | Implementação | Efeito esperado / verificação |
| --- | --- | --- |
| Captura 1× e JPEG antes de ampliar | PNG sem perdas, `captureScale: 2`, escala física do Chromium e emulação alinhadas | Frames reais de 2880×1800 mantendo layout de 1440×900; resolução conferida em cada frame |
| Página reduzida para a moldura e ampliada novamente | Transformação final aplicada diretamente à imagem fonte | Teste com linhas de um pixel preserva contraste no mapeamento 1:1 |
| Filtro cúbico suavizava mesmo sem ampliação | Filtragem escolhida pela relação de pixels fonte/saída | Cubic somente para ampliação; mantém detalhe quando a captura já tem resolução suficiente |
| Renderização repetida de página estática durante movimento do cursor | Cache da página na resolução final, independente da sobreposição do cursor | Reutilização sem ampliar um bitmap intermediário; tolerância máxima de 0,01 pixel na cauda da mola |
| Câmera apontava para coordenadas antigas durante scroll | Eventos de scroll interrompem foco e ligação entre grupos | Recuo antecipado, próximo foco somente após estabilização/visibilidade; fallback para sessões antigas |
| Cliques próximos compartilhavam zoom mas mudavam centro | Região conjunta quando os controles cabem na zona de conforto | Enquadramento estável preservando contexto; teste cobre toda a região do grupo |
| Círculo de clique acompanhava o mouse | Indicador ancorado na coordenada do clique | Local clicado continua identificável enquanto o mouse sai |
| Seta única sobre campos e links | Metadados do DOM, seta/mão/I-beam vetoriais, transição de 80 ms e filtro de eventos breves | Cursor mais coerente; sessões antigas continuam usando seta |
| Segunda animação de clique para digitar no campo já focado | `type` verifica o elemento ativo | Evita clique redundante e mantém digitação visível |
| Trajetórias acumulavam etapas atrasadas | Agendamento pelo tempo real, descarte de amostras vencidas e duração conforme distância/tamanho do alvo | Evita rajadas para recuperar atraso do navegador |
| Scroll sempre tinha 60 incrementos | Agendamento conforme duração e tempo real | Scroll longo deixa de ter sua cadência limitada a 60 incrementos totais; não garante 60 frames fonte |
| Autoscroll esperava sempre 350 ms | Aguarda estabilidade do retângulo no navegador, com limite de tempo | Próximo movimento usa a posição estabilizada do alvo |
| Digitação tinha ciclo mecânico de cinco teclas | Variação determinística por caractere, pequenas pausas entre palavras e pontuação | Ritmo reproduzível com menos repetição perceptível |
| Esperas mudavam instantaneamente de velocidade | Rampas com velocidade/aceleração contínuas, bordas de 550 ms e máximo 4× | Testes numéricos verificam monotonicidade, limites e junções suaves |
| Espera pelo próximo alvo não era considerada | Compressão de preparação longa quando há timestamps e nenhum movimento protegido | Reduz tempo ocioso sem comprimir cliques, mouse ou scroll |
| Qualidade de entrega era fixa em CRF 18 | `--quality high` padrão: CRF 16, preset medium e até oito amostras (16 desde a [segunda passada](motion-review.md#segunda-passada-acabamento-do-vídeo-medido)); `standard`: CRF 18 e cinco | Mais reserva para texto/gradientes; custo maior de CPU e tamanho de arquivo |
| Cores dependiam de conversão implícita | Matriz/primárias BT.709, faixa limitada e transferência sRGB identificadas | Conversão declarada para a fonte sRGB, verificável com ffprobe. No FFmpeg 7.1+ as primárias e a transferência eram descartadas até 26/09; agora o filtro `setparams` as grava ([segunda passada](motion-review.md#segunda-passada-acabamento-do-vídeo-medido)) |

## Escolhas preservadas

Mola criticamente amortecida de 5,8/s, zoom moderado e liberação após 2,4 s de inatividade continuam sendo a base. A revisão não aumenta globalmente a velocidade nem a intensidade dos efeitos. Wallpaper, padding e janela continuam como uma cena única, podendo aparecer naturalmente durante zoom. Pausas editoriais explícitas e focos manuais são respeitados. A fonte permanece reaproveitável; `--pacing original` preserva sua duração.

## Limites e próximos investimentos

1. **Cadência real da página:** CDP entrega frames conforme compositor, carga e codificação. A exportação a 60 fps suaviza câmera/cursor, mas não cria frames novos para scroll e animações da aplicação. Uma captura dedicada por GPU/compositor com timestamps precisa de outro backend e benchmark; duplicar frames não resolve esse limite.
2. **Contexto semântico:** o foco considera retângulos e contêineres compactos. Não interpreta o significado de gráficos, resultados ou mudanças de rota. O roteiro ainda precisa escolher seletores/resultados adequados e `focus` para leitura editorial.
3. **Cursores especiais:** canvas, iframes e ponteiros customizados não têm detecção completa. Os vetores atuais representam três formas, não reproduções oficiais de todo o conjunto de cursores do macOS.
4. **Legibilidade de capturas antigas:** reexportar melhora composição e câmera, mas não recupera resolução já perdida em JPEGs antigos. `sourcePixelsPerOutputPixelAtMaxZoom` abaixo de 1 indica ampliação de pixels.
5. **Tempo de exportação:** PNG Retina e mais amostras custam CPU. Medir pelo `render.json` da sessão; números de versões antigas não garantem o desempenho atual. Aceleração de hardware deve ser avaliada com comparação de qualidade de texto, não apenas velocidade.

## Verificação

`npm test` cobre comportamento e regressões, incluindo geometria, rampas temporais, detalhe de pixels e transições de cursor. `npm run check` verifica sintaxe. O demo longo exercita 38 passos, com formulários, menus, scroll, relatório e resultados assíncronos. Os frames da nova captura foram conferidos em resolução física de 2880×1800. A conclusão visual e os números da exportação estão em `recordings/extended-demo-20260915-retina/`.

Testes e metadados não demonstram equivalência visual ao Screen Studio nem garantem conforto subjetivo para todos os roteiros.
