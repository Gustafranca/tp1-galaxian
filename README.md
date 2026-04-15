# TP1 — Galaxian em WebGL (tema: rio, sapo e moscas)

Trabalho prático de computação gráfica: jogo estilo **Galaxian** em **WebGL 1** (sem TWGL.js), com tema de **margem de rio**: o jogador controla um **sapo** na parte inferior, o **enxame de moscas** move-se em bloco no alto, há **projéteis** do sapo (para cima) e das moscas (para baixo), **colisão AABB** e **texturas** geradas em canvas e enviadas à GPU.

## Como executar

Abra [`index.html`](index.html) a partir de um **servidor HTTP local** (recomendado para texturas e módulos em alguns navegadores), por exemplo:

```bash
npx --yes serve .
```

Depois acesse o URL indicado no terminal (geralmente `http://localhost:3000`).

## Controles

- **Setas** ← → : mover o sapo
- **Espaço** : “língua” / projétil para cima
- **ESC** : pausar / continuar
- **R** : pedir **reinício** (aparece confirmação; **S** ou **Enter** confirma, **N** ou **Esc** cancela)

## Regras (resumo)

- Elimine todas as moscas para **vencer**.
- **Derrota** se uma mosca alcança a margem do sapo ou se o sapo for atingido por um projétil inimigo (com **1 vida** por padrão, conforme o enunciado). Para testar o extra de **múltiplas vidas**, altere `LIVES_START` em [`js/game.js`](js/game.js) (por exemplo para `3`).
- As moscas descem um passo ao tocar nas **laterais** da tela, como no enunciado do Galaxian.

### Rasantes (extra)

Algumas moscas saem do enxame em **rasante**: a ida segue uma **curva cúbica de Bézier** em direção ao sapo e à parte inferior; ao “sair” por baixo, reaparecem no **topo** e voltam ao lugar na formação por **outra Bézier**. Durante o rasante continuam a poder ser escolhidas para **atirar** (mesma cadência global de tiros inimigos). Só **uma** mosca em rasante por vez; ao **voltar** ao lugar na formação, o temporizador do próximo rasante é reiniciado (outra mosca mergulha após o intervalo). Moscas em rasante **não** disparam “chegou ao solo” — só as que ainda estão no bloco contam para essa derrota. Derrubar uma mosca em rasante dá **pontos bônus** (`RASANTE_SCORE_BONUS` em [`js/game.js`](js/game.js)).

## Créditos de recursos

- **Texturas** do sapo, mosca, projéteis e água: desenhadas **proceduralmente** em `canvas` 2D no código ([`js/game.js`](js/game.js)), sem imagens externas — não há dependências de terceiros para arte.

## Estrutura do código

- [`js/webgl.js`](js/webgl.js) — shaders, `mat3` de projeção em pixels, textura e desenho de sprite.
- [`js/game.js`](js/game.js) — entidades, loop, colisão, teclado, HUD em canvas 2D sobreposto.

## Entrega em vídeo

Grave o jogo mostrando movimento do bloco, disparos, colisões, pausa (**ESC**), reinício com confirmação (**R**), vitória e derrota.
