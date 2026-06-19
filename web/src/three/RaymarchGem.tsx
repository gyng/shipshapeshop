import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RARITY_COLOR } from './Gem'
import type { RarityName } from '../game/store'

// Families with an exact signed-distance field — the hero gem raymarches these for TRUE per-pixel
// refraction (real internal bounces, dispersion) and mathematically-exact implicit surfaces (gyroid,
// Schwarz-P/D). Everything else falls back to the mesh + MeshTransmissionMaterial path.
export const RAYMARCH_SHAPES: Record<string, number> = {
  sphere: 0,
  cube: 1,
  octahedron: 2,
  torus: 3,
  ellipsoid: 4,
  gyroid: 5,
  schwarz_p: 6,
  schwarz_d: 7,
  mazur: 0, // the "monster" is secretly a ball
}

const RANK: Record<RarityName, number> = { Common: 0, Rare: 1, Epic: 2, Ssr: 3, Ur: 4, Relic: 4 }

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform int   uShape;
  uniform vec2  uRes;
  uniform vec3  uColor;   // rarity tint (Beer absorption)
  uniform float uIor;
  uniform float uAberr;   // chromatic dispersion
  uniform float uYaw;     // drag-orbit
  uniform float uPitch;

  mat3 R;

  mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
  mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

  // --- procedural cosmos the gem refracts & reflects (same planetarium vibe) ---
  vec3 env(vec3 d){
    float t = d.y*0.5+0.5;
    vec3 col = mix(vec3(0.05,0.035,0.11), vec3(0.16,0.09,0.28), smoothstep(0.0,0.65,t));
    col = mix(col, vec3(0.34,0.11,0.30), smoothstep(0.5,1.0,t)*0.6);
    col += vec3(0.0,0.16,0.13) * smoothstep(0.25,0.0,abs(d.x-0.3)); // teal band
    // stars
    vec3 sd = floor(d*70.0);
    float h = fract(sin(dot(sd, vec3(12.9898,78.233,37.719)))*43758.5453);
    col += vec3(smoothstep(0.992,1.0,h));
    // bright "lightformer" glints
    col += vec3(1.0,0.96,0.9)  * pow(max(dot(d, normalize(vec3(0.55,0.7,0.45))),0.0), 90.0)*2.4; // key
    col += vec3(1.0,0.42,0.72) * pow(max(dot(d, normalize(vec3(-0.6,0.6,-0.4))),0.0), 60.0)*1.4; // pink rim
    col += vec3(0.42,0.95,1.0) * pow(max(dot(d, normalize(vec3(-0.7,0.15,0.55))),0.0), 60.0)*1.0; // cool
    col += vec3(1.0,0.75,0.45) * pow(max(dot(d, normalize(vec3(0.1,-0.8,0.4))),0.0), 50.0)*1.0; // warm moon
    return col;
  }

  float map(vec3 p){
    p = R * p;
    if(uShape==0) return length(p)-1.0;                                   // sphere
    if(uShape==1){ vec3 q=abs(p)-vec3(0.82); return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-0.09; } // round box
    if(uShape==2){ p=abs(p); return (p.x+p.y+p.z-1.35)*0.5773; }          // octahedron (planar approx)
    if(uShape==3){ vec2 q=vec2(length(p.xz)-0.72,p.y); return length(q)-0.30; } // torus
    if(uShape==4){ vec3 r=vec3(1.18,0.72,0.96); float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/k1; } // ellipsoid
    // triply-periodic minimal surfaces, intersected with a sphere → a finite "crystal"
    float fr=3.0;
    vec3 s=sin(p*fr), c=cos(p*fr);
    float g;
    if(uShape==5) g = dot(s, c.zxy);                                      // gyroid
    else if(uShape==6) g = c.x+c.y+c.z;                                   // Schwarz-P
    else g = s.x*s.y*s.z + s.x*c.y*c.z + c.x*s.y*c.z + c.x*c.y*s.z;       // Schwarz-D
    float shell = abs(g)/fr*0.5 - 0.055;
    float sph = length(p)-1.18;
    return max(shell, sph);
  }

  vec3 nrm(vec3 p){
    vec2 e=vec2(0.0012,0.0);
    return normalize(vec3(
      map(p+e.xyy)-map(p-e.xyy),
      map(p+e.yxy)-map(p-e.yxy),
      map(p+e.yyx)-map(p-e.yyx)));
  }

  float trace(vec3 ro, vec3 rd){
    float t=0.0;
    for(int i=0;i<96;i++){
      float d=map(ro+rd*t);
      if(d<0.0007) return t;
      t += d*0.7;                  // <1 for the approximate TPMS fields
      if(t>8.0) break;
    }
    return -1.0;
  }

  // refract in → march the interior → refract out (with per-channel dispersion + Beer absorption)
  vec3 refractGem(vec3 p, vec3 rd, vec3 n){
    vec3 ri = refract(rd, n, 1.0/uIor);
    vec3 ip = p + ri*0.02;
    float dist=0.0;
    for(int i=0;i<40;i++){
      float d = -map(ip);
      if(d<0.0008) break;
      ip += ri*d*0.7; dist += d*0.7;
      if(dist>5.0) break;
    }
    vec3 ne = -nrm(ip);
    vec3 oR = refract(ri, ne, uIor*(1.0-uAberr));
    vec3 oG = refract(ri, ne, uIor);
    vec3 oB = refract(ri, ne, uIor*(1.0+uAberr));
    vec3 tir = reflect(ri, ne);
    if(dot(oR,oR)<0.001) oR=tir;
    if(dot(oG,oG)<0.001) oG=tir;
    if(dot(oB,oB)<0.001) oB=tir;
    vec3 c = vec3(env(oR).r, env(oG).g, env(oB).b);
    vec3 absorb = (vec3(1.0)-uColor) * dist * 0.9;  // rarity-coloured tint via Beer-Lambert
    return c * exp(-absorb);
  }

  void main(){
    R = rotY(uTime*0.12 + uYaw) * rotX(0.4 + uPitch);
    vec2 uv = (vUv*2.0-1.0);
    uv.x *= uRes.x/uRes.y;
    vec3 ro = vec3(0.0,0.0,3.2);
    vec3 rd = normalize(vec3(uv,-2.2));
    float t = trace(ro,rd);
    vec3 col;
    if(t<0.0){
      col = env(rd);
    } else {
      vec3 p = ro+rd*t;
      vec3 n = nrm(p);
      vec3 reflCol = env(reflect(rd,n));
      float f = 0.04 + 0.96*pow(1.0-max(dot(-rd,n),0.0),3.0);
      col = mix(refractGem(p,rd,n), reflCol, f) + reflCol*0.05;
    }
    col = col/(col+vec3(0.55));   // tonemap
    col = pow(col, vec3(0.85));
    gl_FragColor = vec4(col, 1.0);
  }
`

export function RaymarchGem({ family, rarity }: { family: string; rarity: RarityName }) {
  const ref = useRef<THREE.ShaderMaterial>(null)
  const yaw = useRef(0)
  const pitch = useRef(0)
  const drag = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  const uniforms = useMemo(() => {
    const c = new THREE.Color(RARITY_COLOR[rarity])
    return {
      uTime: { value: 0 },
      uShape: { value: RAYMARCH_SHAPES[family] ?? 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      uIor: { value: 1.45 + RANK[rarity] * 0.05 },
      uAberr: { value: 0.02 + RANK[rarity] * 0.02 },
      uYaw: { value: 0 },
      uPitch: { value: 0 },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, rarity])

  useFrame((state) => {
    const m = ref.current
    if (!m) return
    m.uniforms.uTime.value = state.clock.elapsedTime
    m.uniforms.uRes.value.set(state.size.width, state.size.height)
    m.uniforms.uYaw.value = yaw.current
    m.uniforms.uPitch.value = pitch.current
  })

  return (
    <mesh
      frustumCulled={false}
      onPointerDown={(e) => {
        drag.current = true
        last.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        yaw.current += (e.clientX - last.current.x) * 0.01
        pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current + (e.clientY - last.current.y) * 0.01))
        last.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={() => {
        drag.current = false
      }}
      onPointerOut={() => {
        drag.current = false
      }}
    >
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={ref} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  )
}
