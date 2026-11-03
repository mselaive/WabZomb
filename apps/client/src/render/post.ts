import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * El acabado de cámara de La Roca: resplandor en lo que brilla, un grado de color
 * (sombras frías, luces cálidas), viñeta y grano. Si la máquina no llega, se baja
 * la resolución sola.
 */
/** Un solo píxel inválido (NaN) lo desparrama el resplandor por toda la pantalla: se los saca antes. */
const SANITIZE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(24.0)), 1.0);
    }`,
};

const GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uPain: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uPain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      // Un corrimiento de color mínimo, hacia los bordes: la lente es vieja.
      float ca = dot(c, c) * 0.0035;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // Sombras hacia el azul verdoso, luces hacia el ámbar.
      vec3 shadows = vec3(0.86, 0.98, 1.14);
      vec3 highs = vec3(1.08, 1.0, 0.88);
      col *= mix(shadows, highs, smoothstep(0.02, 0.5, l));
      // Un poco menos de saturación, y contraste en S.
      col = mix(vec3(l), col, 0.88);
      col = col * col * (3.0 - 2.0 * col) * 0.35 + col * 0.65;
      float v = smoothstep(0.92, 0.25, length(c));
      col *= mix(0.5, 1.0, v);
      col += (hash(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5) * 0.022;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  private readonly composer: EffectComposer;
  private readonly grade: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private frames = 0;
  private acc = 0;
  private downgraded = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(SANITIZE));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.grade.uniforms.uTime!.value = (this.grade.uniforms.uTime!.value as number) + dt;
    this.composer.render(dt);
    // Si durante 4 s anda por debajo de 40 cuadros, se baja la resolución (dos veces como mucho).
    this.frames++;
    this.acc += dt;
    if (this.acc >= 4) {
      const fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (fps < 40 && this.downgraded < 2) {
        this.downgraded++;
        const ratio = this.renderer.getPixelRatio() * 0.75;
        this.renderer.setPixelRatio(ratio);
        const s = this.renderer.getSize(new THREE.Vector2());
        this.composer.setPixelRatio(ratio);
        this.composer.setSize(s.x, s.y);
        if (this.downgraded === 2) this.bloom.enabled = false;
      }
    }
  }
}
