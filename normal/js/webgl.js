/**
 * Utilitários WebGL 2D: shaders texturados, mat3 em espaço de pixels (origem no canto superior esquerdo)
 * e desenho de sprites como quads reutilizáveis.
 */
(function(global) {
  'use strict';

  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    uniform mat3 u_matrix;
    varying vec2 v_texCoord;
    void main() {
      vec3 pos = u_matrix * vec3(a_position, 1.0);
      gl_Position = vec4(pos.xy, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform vec4 u_tint;
    uniform float u_time;
    varying vec2 v_texCoord;
    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      vec4 color = c * u_tint;
      // Efeito de scanline sutil
      float scanline = sin(v_texCoord.y * 800.0 + u_time * 5.0) * 0.04;
      gl_FragColor = vec4(color.rgb - scanline, color.a);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  /** Multiplicação de matrizes 3x3 (coluna-major), resultado = a * b */
  function multiply(a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2];
    const a10 = a[3], a11 = a[4], a12 = a[5];
    const a20 = a[6], a21 = a[7], a22 = a[8];
    const b00 = b[0], b01 = b[1], b02 = b[2];
    const b10 = b[3], b11 = b[4], b12 = b[5];
    const b20 = b[6], b21 = b[7], b22 = b[8];
    return new Float32Array([
      a00 * b00 + a10 * b01 + a20 * b02,
      a01 * b00 + a11 * b01 + a21 * b02,
      a02 * b00 + a12 * b01 + a22 * b02,
      a00 * b10 + a10 * b11 + a20 * b12,
      a01 * b10 + a11 * b11 + a21 * b12,
      a02 * b10 + a12 * b11 + a22 * b12,
      a00 * b20 + a10 * b21 + a20 * b22,
      a01 * b20 + a11 * b21 + a21 * b22,
      a02 * b20 + a12 * b21 + a22 * b22,
    ]);
  }

  function translation(tx, ty) {
    return new Float32Array([1, 0, 0, 0, 1, 0, tx, ty, 1]);
  }

  function scaling(sx, sy) {
    return new Float32Array([sx, 0, 0, 0, sy, 0, 0, 0, 1]);
  }

  /** Projeção: pixels (0,0 topo-esquerda) → clip space */
  function projection(width, height) {
    return new Float32Array([
      2 / width, 0, 0,
      0, -2 / height, 0,
      -1, 1, 1,
    ]);
  }

  /**
   * @param {WebGLRenderingContext} gl
   * @param {HTMLCanvasElement|HTMLImageElement|ImageBitmap} source
   */
  function createTextureFromSource(gl, source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  /**
   * Inicializa contexto, programa, buffers e estado comum para sprites.
   */
  function createSpriteRenderer(gl) {
    const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    if (!program) {
      throw new Error('Falha ao criar programa WebGL');
    }

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
    const matrixLoc = gl.getUniformLocation(program, 'u_matrix');
    const textureLoc = gl.getUniformLocation(program, 'u_texture');
    const tintLoc = gl.getUniformLocation(program, 'u_tint');
    const timeLoc = gl.getUniformLocation(program, 'u_time');

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();

    // Quad unitário (dois triângulos): posição e UV
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW
    );

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const projCache = {
      w: 0,
      h: 0,
      m: null
    };

    function getProjection(w, h) {
      if (projCache.w !== w || projCache.h !== h) {
        projCache.w = w;
        projCache.h = h;
        projCache.m = projection(w, h);
      }
      return projCache.m;
    }

    /**
     * Desenha um sprite: textura completa no retângulo (x,y) com tamanho (dw, dh) em pixels.
     */
    function drawSprite(texture, x, y, dw, dh, tintR, tintG, tintB, tintA, time) {
      const w = gl.canvas.width;
      const h = gl.canvas.height;
      const P = getProjection(w, h);
      const S = scaling(dw, dh);
      const T = translation(x, y);
      const matrix = multiply(P, multiply(T, S));

      gl.useProgram(program);
      gl.uniformMatrix3fv(matrixLoc, false, matrix);
      gl.uniform1i(textureLoc, 0);
      gl.uniform1f(timeLoc, time || 0);
      gl.uniform4f(
        tintLoc,
        tintR != null ? tintR : 1,
        tintG != null ? tintG : 1,
        tintB != null ? tintB : 1,
        tintA != null ? tintA : 1
      );

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texCoordLoc);
      gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    return {
      program,
      drawSprite,
      createTextureFromSource,
    };
  }

  global.WebGLRiverGame = {
    createProgram,
    createShader,
    createSpriteRenderer,
    createTextureFromSource,
    m3: {
      multiply,
      translation,
      scaling,
      projection
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
