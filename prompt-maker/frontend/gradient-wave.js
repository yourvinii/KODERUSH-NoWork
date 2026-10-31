/*
 * Animated WebGL gradient-wave background (vanilla JS port of the React `GradientWave` component).
 * Usage: const wave = new GradientWave(containerEl, { colors: [...] }); wave.stop();
 * Sizes itself to the container (not the window) and falls back silently if WebGL is missing.
 */
(function () {
  function normalizeColor(hexCode) {
    return [((hexCode >> 16) & 255) / 255, ((hexCode >> 8) & 255) / 255, (255 & hexCode) / 255];
  }

  class MiniGl {
    constructor(canvas) {
      this.canvas = canvas;
      this.meshes = [];
      const gl = canvas.getContext("webgl", { antialias: true });
      if (!gl) throw new Error("WebGL not supported");
      this.gl = gl;
      const context = gl;
      const _miniGl = this;

      this.Uniform = class {
        constructor(e) {
          this.type = "float";
          Object.assign(this, e);
          const typeMap = { float: "1f", int: "1i", vec2: "2fv", vec3: "3fv", vec4: "4fv", mat4: "Matrix4fv" };
          this.typeFn = typeMap[this.type] || "1f";
        }

        update(location) {
          if (this.value === undefined || location === null) return;
          const fn = `uniform${this.typeFn}`;
          if (this.typeFn.indexOf("Matrix") === 0) context[fn](location, this.transpose || false, this.value);
          else context[fn](location, this.value);
        }

        getDeclaration(name, type, length) {
          if (this.excludeFrom === type) return "";
          if (this.type === "array") {
            return (
              this.value[0].getDeclaration(name, type, this.value.length) +
              `\nconst int ${name}_length = ${this.value.length};`
            );
          }
          if (this.type === "struct") {
            let nameNoPrefix = name.replace("u_", "");
            nameNoPrefix = nameNoPrefix.charAt(0).toUpperCase() + nameNoPrefix.slice(1);
            const fields = Object.entries(this.value)
              .map(([n, u]) => u.getDeclaration(n, type).replace(/^uniform/, ""))
              .join("");
            return `uniform struct ${nameNoPrefix} \n{\n${fields}\n} ${name}${length ? `[${length}]` : ""};`;
          }
          return `uniform ${this.type} ${name}${length ? `[${length}]` : ""};`;
        }
      };

      this.Attribute = class {
        constructor(e) {
          this.type = context.FLOAT;
          this.normalized = false;
          this.buffer = context.createBuffer();
          Object.assign(this, e);
        }

        update() {
          if (this.values) {
            context.bindBuffer(this.target, this.buffer);
            context.bufferData(this.target, this.values, context.STATIC_DRAW);
          }
        }

        attach(e, t) {
          const n = context.getAttribLocation(t, e);
          if (this.target === context.ARRAY_BUFFER) {
            context.bindBuffer(this.target, this.buffer);
            context.enableVertexAttribArray(n);
            context.vertexAttribPointer(n, this.size, this.type, this.normalized, 0, 0);
          }
          return n;
        }

        use(e) {
          context.bindBuffer(this.target, this.buffer);
          if (this.target === context.ARRAY_BUFFER) {
            context.enableVertexAttribArray(e);
            context.vertexAttribPointer(e, this.size, this.type, this.normalized, 0, 0);
          }
        }
      };

      this.Material = class {
        constructor(vertexShaders, fragments, uniforms = {}) {
          const material = this;
          this.uniformInstances = [];

          function getShader(type, source) {
            const shader = context.createShader(type);
            context.shaderSource(shader, source);
            context.compileShader(shader);
            if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
              console.error(context.getShaderInfoLog(shader));
              throw new Error("Shader compilation error");
            }
            return shader;
          }

          function getUniformDeclarations(us, type) {
            return Object.entries(us)
              .map(([uniform, value]) => value.getDeclaration(uniform, type))
              .join("\n");
          }

          material.uniforms = uniforms;
          const prefix = "precision highp float;";
          const vertexSource = `
          ${prefix}
          attribute vec4 position;
          attribute vec2 uv;
          attribute vec2 uvNorm;
          ${getUniformDeclarations(_miniGl.commonUniforms, "vertex")}
          ${getUniformDeclarations(uniforms, "vertex")}
          ${vertexShaders}
        `;
          const fragmentSource = `
          ${prefix}
          ${getUniformDeclarations(_miniGl.commonUniforms, "fragment")}
          ${getUniformDeclarations(uniforms, "fragment")}
          ${fragments}
        `;

          material.program = context.createProgram();
          context.attachShader(material.program, getShader(context.VERTEX_SHADER, vertexSource));
          context.attachShader(material.program, getShader(context.FRAGMENT_SHADER, fragmentSource));
          context.linkProgram(material.program);
          if (!context.getProgramParameter(material.program, context.LINK_STATUS)) {
            console.error(context.getProgramInfoLog(material.program));
            throw new Error("Program linking error");
          }
          context.useProgram(material.program);
          material.attachUniforms(undefined, _miniGl.commonUniforms);
          material.attachUniforms(undefined, material.uniforms);
        }

        attachUniforms(name, uniforms) {
          if (name === undefined) {
            Object.entries(uniforms).forEach(([n, u]) => this.attachUniforms(n, u));
          } else if (uniforms.type === "array") {
            uniforms.value.forEach((u, i) => this.attachUniforms(`${name}[${i}]`, u));
          } else if (uniforms.type === "struct") {
            Object.entries(uniforms.value).forEach(([u, i]) => this.attachUniforms(`${name}.${u}`, i));
          } else {
            this.uniformInstances.push({ uniform: uniforms, location: context.getUniformLocation(this.program, name) });
          }
        }
      };

      this.PlaneGeometry = class {
        constructor() {
          this.width = 1;
          this.height = 1;
          this.vertexCount = 0;
          this.xSegCount = 0;
          this.ySegCount = 0;
          this.attributes = {
            position: new _miniGl.Attribute({ target: context.ARRAY_BUFFER, size: 3 }),
            uv: new _miniGl.Attribute({ target: context.ARRAY_BUFFER, size: 2 }),
            uvNorm: new _miniGl.Attribute({ target: context.ARRAY_BUFFER, size: 2 }),
            index: new _miniGl.Attribute({ target: context.ELEMENT_ARRAY_BUFFER, size: 3, type: context.UNSIGNED_SHORT }),
          };
        }

        setTopology(xSegs = 1, ySegs = 1) {
          this.xSegCount = xSegs;
          this.ySegCount = ySegs;
          this.vertexCount = (xSegs + 1) * (ySegs + 1);
          const quadCount = xSegs * ySegs * 2;
          const a = this.attributes;
          a.uv.values = new Float32Array(2 * this.vertexCount);
          a.uvNorm.values = new Float32Array(2 * this.vertexCount);
          a.index.values = new Uint16Array(3 * quadCount);
          for (let y = 0; y <= ySegs; y++) {
            for (let x = 0; x <= xSegs; x++) {
              const i = y * (xSegs + 1) + x;
              a.uv.values[2 * i] = x / xSegs;
              a.uv.values[2 * i + 1] = 1 - y / ySegs;
              a.uvNorm.values[2 * i] = (x / xSegs) * 2 - 1;
              a.uvNorm.values[2 * i + 1] = 1 - (y / ySegs) * 2;
              if (x < xSegs && y < ySegs) {
                const s = y * xSegs + x;
                a.index.values[6 * s] = i;
                a.index.values[6 * s + 1] = i + 1 + xSegs;
                a.index.values[6 * s + 2] = i + 1;
                a.index.values[6 * s + 3] = i + 1;
                a.index.values[6 * s + 4] = i + 1 + xSegs;
                a.index.values[6 * s + 5] = i + 2 + xSegs;
              }
            }
          }
          a.uv.update();
          a.uvNorm.update();
          a.index.update();
        }

        setSize(width = 1, height = 1) {
          this.width = width;
          this.height = height;
          this.attributes.position.values = new Float32Array(3 * this.vertexCount);
          const offsetX = width / -2;
          const offsetY = height / -2;
          const segWidth = width / this.xSegCount;
          const segHeight = height / this.ySegCount;
          for (let y = 0; y <= this.ySegCount; y++) {
            const posY = offsetY + y * segHeight;
            for (let x = 0; x <= this.xSegCount; x++) {
              const idx = y * (this.xSegCount + 1) + x;
              this.attributes.position.values[3 * idx] = offsetX + x * segWidth;
              this.attributes.position.values[3 * idx + 1] = -posY;
              this.attributes.position.values[3 * idx + 2] = 0;
            }
          }
          this.attributes.position.update();
        }
      };

      this.Mesh = class {
        constructor(geometry, material) {
          this.geometry = geometry;
          this.material = material;
          this.attributeInstances = [];
          Object.entries(geometry.attributes).forEach(([e, attribute]) => {
            this.attributeInstances.push({ attribute, location: attribute.attach(e, material.program) });
          });
          _miniGl.meshes.push(this);
        }

        draw() {
          context.useProgram(this.material.program);
          this.material.uniformInstances.forEach(({ uniform, location }) => uniform.update(location));
          this.attributeInstances.forEach(({ attribute, location }) => attribute.use(location));
          context.drawElements(context.TRIANGLES, this.geometry.attributes.index.values.length, context.UNSIGNED_SHORT, 0);
        }
      };

      const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      this.commonUniforms = {
        projectionMatrix: new this.Uniform({ type: "mat4", value: identityMatrix }),
        modelViewMatrix: new this.Uniform({ type: "mat4", value: identityMatrix }),
        resolution: new this.Uniform({ type: "vec2", value: [1, 1] }),
        aspectRatio: new this.Uniform({ type: "float", value: 1 }),
      };
    }

    setSize(w = 640, h = 480) {
      this.width = w;
      this.height = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      this.commonUniforms.resolution.value = [w, h];
      this.commonUniforms.aspectRatio.value = w / h;
    }

    setOrthographicCamera() {
      this.commonUniforms.projectionMatrix.value = [2 / this.width, 0, 0, 0, 0, 2 / this.height, 0, 0, 0, 0, -0.001, 0, 0, 0, 0, 1];
    }

    render() {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clearDepth(1);
      this.meshes.forEach((m) => m.draw());
    }
  }

  const VERTEX_SHADER = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec3 blendNormal(vec3 base, vec3 blend) { return blend; }
vec3 blendNormal(vec3 base, vec3 blend, float opacity) { return (blend * opacity + base * (1.0 - opacity)); }

varying vec3 v_color;

void main() {
  float time = u_time * u_global.noiseSpeed;
  vec2 noiseCoord = resolution * uvNorm * u_global.noiseFreq;
  float tilt = resolution.y / 2.0 * uvNorm.y;
  float incline = resolution.x * uvNorm.x / 2.0 * u_vertDeform.incline;
  float offset = resolution.x / 2.0 * u_vertDeform.incline * mix(u_vertDeform.offsetBottom, u_vertDeform.offsetTop, uv.y);

  float noise = snoise(vec3(
    noiseCoord.x * u_vertDeform.noiseFreq.x + time * u_vertDeform.noiseFlow,
    noiseCoord.y * u_vertDeform.noiseFreq.y,
    time * u_vertDeform.noiseSpeed + u_vertDeform.noiseSeed
  )) * u_vertDeform.noiseAmp;

  noise *= 1.0 - pow(abs(uvNorm.y), 2.0);
  noise = max(0.0, noise);

  vec3 pos = vec3(position.x, position.y + tilt + incline + noise - offset, position.z);

  v_color = u_baseColor;

  for (int i = 0; i < u_waveLayers_length; i++) {
    if (u_active_colors[i + 1] == 1.) {
      WaveLayers layer = u_waveLayers[i];
      float layerNoise = smoothstep(
        layer.noiseFloor,
        layer.noiseCeil,
        snoise(vec3(
          noiseCoord.x * layer.noiseFreq.x + time * layer.noiseFlow,
          noiseCoord.y * layer.noiseFreq.y,
          time * layer.noiseSpeed + layer.noiseSeed
        )) / 2.0 + 0.5
      );
      v_color = blendNormal(v_color, layer.color, pow(layerNoise, 4.));
    }
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

  const FRAGMENT_SHADER = `
varying vec3 v_color;

void main() {
  vec3 color = v_color;
  if (u_darken_top == 1.0) {
    vec2 st = gl_FragCoord.xy/resolution.xy;
    color.g -= pow(st.y + sin(-12.0) * st.x, u_shadow_power) * 0.4;
  }
  gl_FragColor = vec4(color, 1.0);
}`;

  class Gradient {
    constructor(canvas, container, colors) {
      this.canvas = canvas;
      this.container = container;
      this.colors = colors;
      this.time = 0;
      this.last = 0;
      this.isPlaying = false;
      this.minigl = new MiniGl(canvas);
      this.init();
    }

    init() {
      const U = this.minigl.Uniform;
      const sectionColors = this.colors.map((hex) => normalizeColor(parseInt(hex.replace("#", "0x"), 16)));
      const uniforms = {
        u_time: new U({ value: 0 }),
        u_shadow_power: new U({ value: 5 }),
        u_darken_top: new U({ value: 0 }),
        u_active_colors: new U({ value: [1, 1, 1, 1], type: "vec4" }),
        u_global: new U({
          value: {
            noiseFreq: new U({ value: [0.00014, 0.00029], type: "vec2" }),
            noiseSpeed: new U({ value: 0.000005 }),
          },
          type: "struct",
        }),
        u_vertDeform: new U({
          value: {
            incline: new U({ value: 0 }),
            offsetTop: new U({ value: -0.5 }),
            offsetBottom: new U({ value: -0.5 }),
            noiseFreq: new U({ value: [3, 4], type: "vec2" }),
            noiseAmp: new U({ value: 320 }),
            noiseSpeed: new U({ value: 10 }),
            noiseFlow: new U({ value: 3 }),
            noiseSeed: new U({ value: 5 }),
          },
          type: "struct",
          excludeFrom: "fragment",
        }),
        u_baseColor: new U({ value: sectionColors[0], type: "vec3", excludeFrom: "fragment" }),
        u_waveLayers: new U({ value: [], excludeFrom: "fragment", type: "array" }),
      };

      for (let i = 1; i < sectionColors.length; i++) {
        uniforms.u_waveLayers.value.push(
          new U({
            value: {
              color: new U({ value: sectionColors[i], type: "vec3" }),
              noiseFreq: new U({ value: [2 + i / sectionColors.length, 3 + i / sectionColors.length], type: "vec2" }),
              noiseSpeed: new U({ value: 11 + 0.3 * i }),
              noiseFlow: new U({ value: 6.5 + 0.3 * i }),
              noiseSeed: new U({ value: 5 + 10 * i }),
              noiseFloor: new U({ value: 0.1 }),
              noiseCeil: new U({ value: 0.63 + 0.07 * i }),
            },
            type: "struct",
          })
        );
      }

      const material = new this.minigl.Material(VERTEX_SHADER, FRAGMENT_SHADER, uniforms);
      this.mesh = new this.minigl.Mesh(new this.minigl.PlaneGeometry(), material);
      this.resize();
    }

    resize() {
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;
      this.minigl.setSize(width, height);
      this.minigl.setOrthographicCamera();
      this.mesh.geometry.setTopology(Math.ceil(width * 0.02), Math.ceil(height * 0.05));
      this.mesh.geometry.setSize(width, height);
      this.mesh.material.uniforms.u_shadow_power.value = width < 600 ? 5 : 6;
      if (!this.isPlaying) this.minigl.render();
    }

    animate = (timestamp) => {
      if (!this.isPlaying) return;
      this.time += Math.min(timestamp - this.last, 1000 / 15);
      this.last = timestamp;
      this.mesh.material.uniforms.u_time.value = this.time;
      this.minigl.render();
      this.animationId = requestAnimationFrame(this.animate);
    };

    start() {
      this.isPlaying = true;
      this.animationId = requestAnimationFrame(this.animate);
    }

    stop() {
      this.isPlaying = false;
      if (this.animationId) cancelAnimationFrame(this.animationId);
    }
  }

  window.GradientWave = class GradientWave {
    constructor(container, opts = {}) {
      const {
        colors = ["#38bdf8", "#ffffff", "#38bdf8", "#ffffff", "#38bdf8", "#ffffff"],
        isPlaying = true,
        shadowPower = 8,
        darkenTop = false,
        noiseSpeed = 0.00001,
        noiseFrequency = [0.0001, 0.0009],
        deform = {},
      } = opts;

      this.canvas = document.createElement("canvas");
      Object.assign(this.canvas.style, { position: "absolute", top: "0", left: "0", width: "100%", height: "100%", display: "block" });
      container.appendChild(this.canvas);

      try {
        const g = (this.gradient = new Gradient(this.canvas, container, colors));
        const u = g.mesh.material.uniforms;
        u.u_shadow_power.value = shadowPower;
        u.u_darken_top.value = darkenTop ? 1 : 0;
        u.u_global.value.noiseFreq.value = noiseFrequency;
        u.u_global.value.noiseSpeed.value = noiseSpeed;
        // The React original overwrote these Uniform objects with raw numbers, so its `deform` never reached the shader;
        // here it really applies. Default is {} to keep the look the original actually renders.
        Object.entries(deform).forEach(([k, v]) => (u.u_vertDeform.value[k].value = v));
        g.resize();
        if (isPlaying) g.start();
        this.observer = new ResizeObserver(() => g.resize());
        this.observer.observe(container);
      } catch (e) {
        console.error("GradientWave disabled:", e);
        this.canvas.remove();
      }
    }

    // Smoothly fade every wave colour to a new palette (same length as the initial one).
    setColors(colors, ms = 900) {
      const g = this.gradient;
      if (!g) return;
      const u = g.mesh.material.uniforms;
      const slots = [u.u_baseColor, ...u.u_waveLayers.value.map((l) => l.value.color)];
      const from = slots.map((s) => s.value.slice());
      const to = colors.map((h) => normalizeColor(parseInt(h.replace("#", "0x"), 16)));
      cancelAnimationFrame(this.tween);
      const t0 = performance.now();
      const step = (now) => {
        const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
        slots.forEach((s, i) => { if (to[i]) s.value = from[i].map((v, j) => v + (to[i][j] - v) * e); });
        if (!g.isPlaying) g.minigl.render();
        if (k < 1) this.tween = requestAnimationFrame(step);
      };
      this.tween = requestAnimationFrame(step);
    }

    stop() {
      cancelAnimationFrame(this.tween);
      this.gradient?.stop();
      this.observer?.disconnect();
    }
  };
})();
