# Histórico técnico

Estas notas descrevem versões anteriores. O estado atual está no [README](../README.md) e na [revisão de qualidade](quality-review.md).

## Histórico: revisão de qualidade (2026-09-09)

As medições abaixo são da arquitetura anterior. Para o estado atual, consulte a [revisão de qualidade de 15/09](quality-review.md).

A composição da página é reutilizada enquanto o frame capturado não muda; câmera e cursor continuam animados a cada frame. Em uma medição local da mesma sessão de 9,553 s a 1280×720/60 fps, o render passou de 41,36 s para 19,84 s. A memória amostrada passou de 210 MB para 271 MB. Esses números são uma medição nesta máquina, não uma garantia para outros roteiros.

Movimentos de até dois pixels não repetem a animação de deslocamento. O intervalo automático varia de 150 a 550 ms conforme a ação; `pause` continua disponível para ritmo editorial explícito. O foco permanece durante `expect` e o cursor permanece visível durante a digitação. `focus` aceita elementos visíveis mesmo quando não são clicáveis. `timeout` no roteiro aceita 1–120000 ms (padrão 10000).

O render usa `--pacing balanced` por padrão. Esperas sem atividade acima de 2,6 s são reduzidas com uma rampa temporal que preserva os primeiros e os últimos 550 ms em velocidade real; cliques, digitação, rolagem e a resposta final da interface não são removidos. Use `--pacing original` quando a duração capturada tiver significado e precisar ser mantida integralmente. `render.json` informa quantas lacunas foram ajustadas e quantos segundos foram economizados.


## Referências de movimento

A revisão de conforto consultou o código de [Recordly: tempos](https://github.com/webadderall/Recordly/blob/main/src/components/video-editor/videoPlayback/constants.ts), [ligação de regiões](https://github.com/webadderall/Recordly/blob/main/src/components/video-editor/videoPlayback/zoomRegionUtils.ts) e [OpenScreen: suavização da câmera](https://github.com/siddharthvaddem/openscreen/blob/main/src/components/video-editor/videoPlayback/zoomSpring.ts). Recordly define aproximadamente 1,52 s de entrada, 1,02 s de saída e ligação por pan entre regiões próximas. OpenScreen aplica uma mola ao alvo animado para suavizar descontinuidades de velocidade.

Nossa implementação continua própria: mola criticamente amortecida com frequência 5,8/s (entre as versões rápida de 8/s e lenta de 4,5/s), aproximação de cerca de 99% ao alvo em 1,15 s quando ele está fixo, zoom moderado, ligação de intervalos curtos e escala compartilhada para cliques/digitação próximos. Inatividade real continua liberando o zoom após 2,4 s; uma próxima ação iminente pode prolongar o enquadramento para evitar um recuo seguido de aproximação. Novas capturas usam deslocamentos do cursor um pouco mais longos. Reexportar não altera a velocidade das ações e rolagens já gravadas.


## Revisão de naturalidade (2026-09-12)

A antecipação respeita o momento em que o alvo ficou disponível nas novas capturas, além da duração de foco manual/digitação anterior. Movimentos posteriores não reativam um foco expirado. O cursor reaparece gradualmente após inatividade, e grupos conectados compartilham a mesma escala até o fim do grupo.

Quando necessário, a exportação mantém o último frame capturado por um curto período para completar o zoom-out final. `render.json` distingue `capturedDuration`, `duration` e `closingHoldSeconds`; a captura original permanece intacta. A velocidade equilibrada da câmera permanece em 5,8/s.

Limites de qualidade: transições da própria aplicação, scroll já gravado, resolução dos JPEGs, contêineres mal escolhidos e esperas de rede ainda influenciam o vídeo. Capturas antigas não têm `readyAt` nem sempre separam digitação de espera; a antecipação nesses arquivos é uma estimativa. Nas capturas daquela versão, a seta não alternava para mão/I-beam. Testes verificam continuidade e timing, não conforto subjetivo nem sucesso semântico da aplicação: `expect` apenas verifica visibilidade.

