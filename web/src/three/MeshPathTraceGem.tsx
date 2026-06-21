import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO, OrbitControls, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { RARITY_COLOR } from './Gem'
import { shapeGeometry, useRelics } from './relics'
import { buildBVH } from './bvh'
import { sceneById } from '../content/cosmetics'
import { useGame, type RarityName } from '../game/store'
import { usePathTraceParams, useGfxPreset } from '../gfx'

// ── From-scratch GPU MESH path tracer (NO library) ────────────────────────────────────────────────────────
// The sibling of PathTraceGem for arbitrary triangle meshes (knots, Klein, relics, fractals): the CPU builds a
// BVH (bvh.ts) packed into float textures; this GLSL3 shader walks it with a stack, intersects triangles
// (Möller–Trumbore), and runs the same multi-bounce glass transport + progressive accumulation as the SDF
// tracer. GLSL ES 3.00 is required (texelFetch + a dynamic traversal stack). Flat (geometric) normals for now.

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4, Meta: 4, Transcendent: 4 }

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const makeMeshPT = (BOUNCES: number, SPP: number) => /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec2 vUv;
  out vec4 fragColor;
  uniform float uSeed;
  uniform vec2  uRes;
  uniform vec3  uColor;
  uniform float uIor;
  uniform float uTime;     // gentle auto-spin (composes with the orbit)
  uniform float uYaw, uPitch, uZoom;
  uniform vec3  uBackdrop, uKey, uCool, uWarm, uStar;
  uniform sampler2D uTriTex;   // 3 texels/tri (a,b,c)
  uniform sampler2D uNodeTex;  // 2 texels/node
  uniform int uTexW;
  uniform int uNodeCount;

  float gSeed;
  float rnd(){ gSeed += 1.0; vec3 p3 = fract(vec3(gl_FragCoord.xyx) * 0.1031 + gSeed * 0.137 + uSeed * 0.0411); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  vec3 env(vec3 d){
    float t = d.y*0.5+0.5;
    vec3 col = mix(uBackdrop*0.30, uBackdrop*1.10, smoothstep(0.0,0.65,t));
    col = mix(col, uBackdrop*1.6, smoothstep(0.5,1.0,t)*0.5);
    col += uCool*0.5 * smoothstep(0.25,0.0,abs(d.x-0.3));
    vec3 sd = floor(d*70.0);
    float h = fract(sin(dot(sd, vec3(12.9898,78.233,37.719)))*43758.5453);
    col += uStar * smoothstep(0.992,1.0,h);
    col += uKey  * pow(max(dot(d, normalize(vec3(0.55,0.7,0.45))),0.0), 90.0)*2.4;
    col += uWarm * pow(max(dot(d, normalize(vec3(-0.6,0.6,-0.4))),0.0), 60.0)*1.4;
    col += uCool * pow(max(dot(d, normalize(vec3(-0.7,0.15,0.55))),0.0), 60.0)*1.0;
    col += uWarm * pow(max(dot(d, normalize(vec3(0.1,-0.8,0.4))),0.0), 50.0)*1.0;
    return col;
  }

  vec4 ftri(int i){ return texelFetch(uTriTex, ivec2(i % uTexW, i / uTexW), 0); }
  vec4 fnode(int i){ return texelFetch(uNodeTex, ivec2(i % uTexW, i / uTexW), 0); }

  // Möller–Trumbore; updates t + geometric normal on a nearer hit.
  bool hitTri(vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2, inout float t, inout vec3 n){
    vec3 e1 = v1-v0, e2 = v2-v0;
    vec3 pv = cross(rd, e2);
    float det = dot(e1, pv);
    if(abs(det) < 1e-9) return false;
    float inv = 1.0/det;
    vec3 tv = ro - v0;
    float u = dot(tv, pv)*inv; if(u < 0.0 || u > 1.0) return false;
    vec3 qv = cross(tv, e1);
    float v = dot(rd, qv)*inv; if(v < 0.0 || u+v > 1.0) return false;
    float tt = dot(e2, qv)*inv;
    if(tt > 0.0009 && tt < t){ t = tt; n = normalize(cross(e1, e2)); return true; }
    return false;
  }

  bool hitAABB(vec3 ro, vec3 invRd, vec3 bmin, vec3 bmax, float tMax){
    vec3 t0 = (bmin-ro)*invRd, t1 = (bmax-ro)*invRd;
    vec3 lo = min(t0,t1), hi = max(t0,t1);
    float tn = max(max(lo.x,lo.y),lo.z);
    float tf = min(min(hi.x,hi.y),hi.z);
    return tf >= max(tn, 0.0) && tn < tMax;
  }

  // walk the BVH (explicit stack) for the nearest triangle hit
  bool intersect(vec3 ro, vec3 rd, out float tHit, out vec3 nHit){
    vec3 invRd = 1.0/rd;
    int stack[40];
    int sp = 0; stack[sp++] = 0;
    tHit = 1e9; bool hit = false;
    int guard = 0;
    while(sp > 0 && guard < 4096){
      guard++;
      int ni = stack[--sp];
      vec4 a = fnode(ni*2);
      vec4 b = fnode(ni*2+1);
      if(!hitAABB(ro, invRd, a.xyz, b.xyz, tHit)) continue;
      if(b.w < 0.0){                                   // leaf: w encodes -triCount
        int start = int(a.w + 0.5);
        int cnt = int(-b.w + 0.5);
        for(int k=0;k<cnt;k++){
          int ti = (start+k)*3;
          vec3 v0 = ftri(ti).xyz, v1 = ftri(ti+1).xyz, v2 = ftri(ti+2).xyz;
          if(hitTri(ro, rd, v0, v1, v2, tHit, nHit)) hit = true;
        }
      } else if(sp < 38){                              // internal: push both children
        stack[sp++] = int(a.w + 0.5);
        stack[sp++] = int(b.w + 0.5);
      }
    }
    return hit;
  }

  void main(){
    mat3 R = mat3(1.0);
    {
      float yaw = uTime * 0.15 + uYaw;
      float cy=cos(yaw), sy=sin(yaw), cx=cos(0.4+uPitch), sx=sin(0.4+uPitch);
      mat3 ry = mat3(cy,0.,sy, 0.,1.,0., -sy,0.,cy);
      mat3 rx = mat3(1.,0.,0., 0.,cx,-sx, 0.,sx,cx);
      R = ry * rx;
    }
    mat3 Rt = transpose(R);   // world → object (R is orthonormal)
    gSeed = 0.0;
    float F0 = pow((1.0-uIor)/(1.0+uIor), 2.0);

    vec3 sum = vec3(0.0);
    for(int s=0;s<${SPP};s++){
      vec2 j = (vec2(rnd(), rnd())-0.5);
      vec2 uv = ((vUv*uRes + j)/uRes * 2.0 - 1.0);
      uv.x *= uRes.x/uRes.y;
      // primary ray (world), then into object space so the static BVH appears rotated by R
      vec3 ro = Rt * vec3(0.0,0.0,3.2*uZoom);
      vec3 rd = normalize(Rt * normalize(vec3(uv,-2.2)));
      vec3 thru = vec3(1.0), rad = vec3(0.0);
      bool inside = false;
      for(int b=0;b<${BOUNCES};b++){
        float t; vec3 n;
        if(!intersect(ro, rd, t, n)){ rad += thru * env(R * rd); break; }  // escaped → world-space env
        vec3 p = ro + rd*t;
        if(dot(rd, n) > 0.0) n = -n;                   // face the incoming ray
        if(inside) thru *= exp(-(vec3(1.0)-uColor) * min(t,0.9) * 1.1);
        float ci = clamp(dot(-rd, n), 0.0, 1.0);
        float F = F0 + (1.0-F0)*pow(1.0-ci, 5.0);
        float eta = inside ? uIor : 1.0/uIor;
        vec3 refr = refract(rd, n, eta);
        if(dot(refr,refr) < 1e-6 || rnd() < F){ rd = reflect(rd, n); }
        else { rd = refr; inside = !inside; }
        ro = p + rd*0.0015;
        if(b > 2){ float q = max(thru.r, max(thru.g, thru.b)); if(rnd() > q) break; thru /= max(q, 0.05); }
      }
      sum += max(rad, 0.0);
    }
    fragColor = vec4(sum / float(${SPP}), 1.0);
  }
`

const DISP = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTex;
  uniform float uN;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  void main(){
    vec3 c = texture(uTex, vUv).rgb / max(uN, 1.0);
    c = aces(c * 1.8);   // exposure lift — PT glass is env-lit only (no direct/rim lights), so it reads dark raw
    c = pow(c, vec3(1.0/2.2));
    fragColor = vec4(c, 1.0);
  }
`

export function MeshPathTraceGem({ family, rarity, controls = true }: { family: string; rarity: RarityName; controls?: boolean }) {
  const { gl, size } = useThree()
  const scene = sceneById(useGame((s) => s.view?.scene ?? 0))
  const ptp = usePathTraceParams()
  const g = useGfxPreset()
  const rank = RANK[rarity]
  useRelics() // rebuild the BVH once the real Relic mesh arrives
  const geo = shapeGeometry(family)
  const bvh = useMemo(() => buildBVH(geo), [geo])
  const w = Math.max(2, Math.round(size.width * ptp.scale))
  const h = Math.max(2, Math.round(size.height * ptp.scale))
  const accum = useFBO(w, h, { type: THREE.FloatType, depthBuffer: false })

  const lin = (hex: string) => { const k = new THREE.Color(hex).convertSRGBToLinear(); return new THREE.Vector3(k.r, k.g, k.b) }
  const ptMat = useMemo(() => {
    const [backdrop, key, cool, warm] = scene.env
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: makeMeshPT(ptp.bounces, ptp.spp),
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) },
        uColor: { value: lin(RARITY_COLOR[rarity]) }, uIor: { value: 1.45 + RANK[rarity] * 0.05 },
        uTime: { value: 0 }, uYaw: { value: 0 }, uPitch: { value: 0 }, uZoom: { value: 1 },
        uBackdrop: { value: lin(backdrop) }, uKey: { value: lin(key) }, uCool: { value: lin(cool) }, uWarm: { value: lin(warm) }, uStar: { value: lin(scene.stars) },
        uTriTex: { value: bvh.triTex }, uNodeTex: { value: bvh.nodeTex }, uTexW: { value: bvh.texW }, uNodeCount: { value: bvh.nodeCount },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, rarity, scene, bvh, ptp.bounces, ptp.spp, w, h])

  const dispMat = useMemo(() => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DISP, depthTest: false, depthWrite: false, uniforms: { uTex: { value: accum.texture }, uN: { value: 1 } } }), [accum])
  const quad = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
  const ptScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, ptMat)); return s }, [quad, ptMat])
  const dispScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, dispMat)); return s }, [quad, dispMat])
  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
  const frame = useRef(0)
  const lastKey = useRef('')

  useFrame((state) => {
    const m = ptMat.uniforms
    m.uTime.value = state.clock.elapsedTime
    const cam = state.camera
    const dist = cam.position.length() || 5
    m.uZoom.value = THREE.MathUtils.clamp(dist / 5, 0.45, 2.6)
    m.uYaw.value = Math.atan2(cam.position.x, cam.position.z)
    const polar = Math.acos(THREE.MathUtils.clamp(cam.position.y / dist, -1, 1))
    m.uPitch.value = THREE.MathUtils.clamp(Math.PI / 2 - polar, -1.4, 1.4)

    const spin = m.uTime.value * 0.15 + m.uYaw.value
    const key = `${family}|${spin.toFixed(4)}|${m.uPitch.value.toFixed(4)}|${m.uZoom.value.toFixed(4)}`
    const prevClear = gl.getClearColor(new THREE.Color()).getHex()
    if (key !== lastKey.current) {
      lastKey.current = key
      frame.current = 0
      gl.setRenderTarget(accum)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
    }
    m.uSeed.value = frame.current
    const prevAuto = gl.autoClear
    gl.autoClear = false
    gl.setRenderTarget(accum)
    gl.render(ptScene, ortho)
    frame.current++
    dispMat.uniforms.uTex.value = accum.texture
    dispMat.uniforms.uN.value = frame.current
    gl.setRenderTarget(null)
    gl.render(dispScene, ortho)
    // composite the foreground motes (R3F scene, real camera) over the path-traced image — the sparkle/halo the
    // mesh Stage had. clearDepth so they aren't culled by the fullscreen quad's depth.
    gl.clearDepth()
    gl.render(state.scene, state.camera)
    gl.autoClear = prevAuto
    gl.setClearColor(prevClear)
  }, 1)

  return (
    <>
      <group />
      <Sparkles count={Math.round((36 + rank * 28) * g.sparkle)} scale={[8, 6, 6]} size={2.2 + rank * 0.5} speed={0.18} opacity={0.7} color={scene.stars} />
      {rank >= 2 && <Sparkles count={Math.round((20 + rank * 22) * g.sparkle)} scale={[4.5, 4.5, 4.5]} size={3.4} speed={0.5} opacity={0.9} color={RARITY_COLOR[rarity]} />}
      {controls && (
        <OrbitControls makeDefault enablePan={false} enableZoom minDistance={3} maxDistance={9} rotateSpeed={0.9}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      )}
    </>
  )
}
