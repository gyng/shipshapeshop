// ── Optics Bench ─────────────────────────────────────────────────────────────────────────────────────────────
// A standalone light-transport testbed (mounted at ?optics). It's a physically-based THIN-LENS CAMERA: for every
// SENSOR pixel we sample the APERTURE (a disk on the lens) and trace a ray through the lens toward the per-pixel
// focus point in a depth-varied SCENE, accumulating over frames. That single model reproduces the real camera
// effects you can dial in live:
//   • APERTURE  — a pinhole (everything sharp) → a wide stop (shallow depth-of-field + big aperture-shaped bokeh).
//   • FOCUS     — sweep which depth is razor-sharp; everything else blurs by how far it sits from the focus plane.
//   • CHROMATIC ABERRATION — the lens's index of refraction varies with wavelength, so each colour focuses at a
//                 slightly different distance (longitudinal CA) — defocused highlights fringe blue/red, in-focus
//                 points stay white. We trace one hero wavelength per sample and tint it with the same CIE spectral
//                 pipeline the gems use, so the fringing is physically coloured, not a hand-tuned RGB split.
// No game core is booted; it's a pure optics sandbox.
import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { SPECTRAL_GLSL } from '../three/ptShared.glsl'
import { sdfActiveGLSL, SDF_FAMILIES } from '../three/sdfShapes.glsl'

const VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`

const SPP = 6 // aperture/wavelength samples per frame (accumulated over frames → smooth bokeh + clean CA)
const SUBJECT_Z = 6.0 // where the subject shape sits (so the default focus=6 lands right on it)

// The fragment shader is built per-subject: when a SHAPE is chosen we inject its SDF (sdfActiveGLSL) and refract the
// light scene through it as a glass subject; with no shape it just images the lights.
const makeFrag = (sdfGLSL: string, hasShape: boolean) => /* glsl */ `
  precision highp float;
  out vec4 fragColor;
  uniform vec2  uRes;
  uniform float uSeed;      // accumulation frame index (RNG salt)
  uniform float uAperture;  // aperture radius (0 = pinhole → everything sharp)
  uniform float uFocus;     // focus-plane distance (z where the scene is sharp)
  uniform float uFov;       // focal length (larger = narrower field of view / more magnification)
  uniform float uDisp;      // chromatic aberration: per-wavelength focus shift (longitudinal CA)
  uniform float uSpin;      // slow scene rotation so the depth structure reads as 3D
  uniform float uIor;       // subject glass index of refraction
  uniform float uSubjScale; // subject size
  uniform vec3  uTint;      // subject glass body tint (multiplies the refracted light)
  uniform float uLightCount;// how many scene point-lights are lit (particle density)
  uniform float uYaw;       // camera orbit yaw (around the subject)
  uniform float uPitch;     // camera orbit pitch
  uniform float uOrbitR;    // camera distance to the subject

  float gSeed;
  float rnd(){
    gSeed += 1.0;
    vec3 p3 = fract(vec3(gl_FragCoord.xyx) * 0.1031 + gSeed * 0.137 + uSeed * 0.0411);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

${SPECTRAL_GLSL}

  // The test SCENE: a rainbow HELIX of point lights receding into depth (each a crisp Gaussian point when the
  // aperture rays converge on it = in focus), plus a dim back-wall grid for a spatial reference. The helix spans a
  // wide depth range, so at any one focus setting a slice of it is sharp and the rest bokehs.
  #define NPTS 30
  vec3 ptPos(int i){
    float fi = float(i);
    float a = fi * 0.62 + uSpin;
    float z = 2.6 + fi * 0.34;             // depth 2.6 (near) → ~12.5 (far)
    return vec3(cos(a) * 1.15, sin(a) * 1.15, z);
  }
  vec3 ptCol(int i){
    float h = fract(float(i) / 6.0);       // cycle the spectrum along the helix
    return (0.55 + 0.55 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)))) * 3.2;
  }
  vec3 sceneLights(vec3 ro, vec3 rd){
    vec3 acc = vec3(0.0);
    for(int i = 0; i < NPTS; i++){
      if(float(i) >= uLightCount) break;   // scene light density (particle count)
      vec3 oc = ptPos(i) - ro;
      float b = dot(oc, rd);
      if(b <= 0.0) continue;               // behind the lens
      float m2 = dot(oc, oc) - b * b;      // squared perpendicular miss distance
      acc += ptCol(i) * exp(-m2 / 0.0016); // crisp point (only near-hits when the aperture rays converge = in focus)
    }
    // dim back-wall grid at z = 13.5 — a fixed reference plane so focus/defocus is legible against structure
    if(rd.z > 0.0){
      float tW = (13.5 - ro.z) / rd.z;
      vec3 wp = ro + rd * tW;
      vec2 g = abs(fract(wp.xy * 0.5) - 0.5);
      float line = smoothstep(0.03, 0.0, min(g.x, g.y));
      acc += vec3(0.04, 0.05, 0.08) * (0.25 + line * 0.8);
    }
    return acc;
  }
${hasShape ? `
  ${sdfGLSL}
  // the chosen SDF, placed at (0,0,SUBJECT_Z) and scaled — a GLASS subject the camera photographs.
  float mapShape(vec3 p){ return sdfActive((p - vec3(0.0, 0.0, ${SUBJECT_Z.toFixed(1)})) / uSubjScale) * uSubjScale; }
  float marchShape(vec3 ro, vec3 rd, float sgn){
    float t = 0.01;
    for(int i = 0; i < 96; i++){ float d = sgn * mapShape(ro + rd * t); if(d < 0.0012) return t; t += max(d * 0.8, 0.004); if(t > 22.0) break; }
    return -1.0;
  }
  vec3 nrmShape(vec3 p){ vec2 e = vec2(0.004, 0.0);
    return normalize(vec3(mapShape(p+e.xyy)-mapShape(p-e.xyy), mapShape(p+e.yxy)-mapShape(p-e.yxy), mapShape(p+e.yyx)-mapShape(p-e.yyx))); }
  // Glass subject: refract the light scene through it (enter → march to exit → refract out) + a Fresnel reflection
  // of the scene + a faint rim. The whole thing is traced from the thin-lens ray, so the CAMERA's DOF/bokeh applies.
  vec3 traceScene(vec3 ro, vec3 rd){
    float tS = marchShape(ro, rd, 1.0);
    if(tS < 0.0) return sceneLights(ro, rd);
    vec3 p = ro + rd * tS; vec3 n = nrmShape(p);
    float ci = clamp(dot(-rd, n), 0.0, 1.0);
    float F0 = pow((1.0 - uIor) / (1.0 + uIor), 2.0);
    float F = F0 + (1.0 - F0) * pow(1.0 - ci, 5.0);
    vec3 refl = sceneLights(p + reflect(rd, n) * 0.02, reflect(rd, n));   // scene reflected off the front face
    vec3 rin = refract(rd, n, 1.0 / uIor);                               // refract in
    vec3 through;
    vec3 pe = p + rin * 0.01; float te = marchShape(pe, rin, -1.0);       // march to the exit wall
    if(te > 0.0){
      vec3 xp = pe + rin * te; vec3 ne = -nrmShape(xp);
      vec3 rout = refract(rin, ne, uIor);                                // refract out
      if(dot(rout, rout) < 1e-5) rout = reflect(rin, ne);                // total internal reflection
      through = sceneLights(xp + rout * 0.02, rout);
    } else { through = sceneLights(pe, rin); }
    return mix(through * uTint, refl, F) + vec3(0.03, 0.04, 0.06) * pow(1.0 - ci, 3.0); // tinted body + faint Fresnel rim
  }
` : `
  vec3 traceScene(vec3 ro, vec3 rd){ return sceneLights(ro, rd); }
`}
  void main(){
    gSeed = 0.0;
    vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
    ndc.x *= uRes.x / uRes.y;
    // camera ORBITS the subject (at z = SUBJECT_Z): the lens/sensor sits uOrbitR away along the yaw/pitch direction,
    // looking back at the subject. (yaw=0, pitch=0, uOrbitR=SUBJECT_Z reproduces the head-on view from the origin.)
    vec3 cSubj = vec3(0.0, 0.0, ${SUBJECT_Z.toFixed(1)});
    vec3 fwd = normalize(vec3(sin(uYaw) * cos(uPitch), sin(uPitch), cos(uYaw) * cos(uPitch)));
    vec3 camPos = cSubj - fwd * uOrbitR;
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 dirC = normalize(fwd * uFov + right * ndc.x + up * ndc.y); // the chief ray, through the lens centre

    vec3 sum = vec3(0.0);
    for(int s = 0; s < ${SPP}; s++){
      // one hero wavelength per sample → per-λ focus distance = LONGITUDINAL chromatic aberration.
      float wl = fract((float(s) + rnd()) / float(${SPP}));
      float tFocus = (uFocus * (1.0 + uDisp * (wl - 0.5))) / dirC.z; // where THIS colour's chief ray meets its focus plane
      vec3 pFocus = camPos + dirC * tFocus;
      // sample a point on the aperture disk; the real ray goes from there THROUGH the focus point.
      float ra = sqrt(rnd()) * uAperture, ang = 6.2831853 * rnd();
      vec3 lensP = camPos + (right * cos(ang) + up * sin(ang)) * ra;
      vec3 rd = normalize(pFocus - lensP);
      sum += traceScene(lensP, rd) * spectralWeight(wl); // tint by the sample's wavelength → physically-coloured CA
    }
    fragColor = vec4(sum / float(${SPP}), 1.0); // LINEAR HDR — accumulated additively off-screen
  }
`

const DISP = /* glsl */ `
  precision highp float;
  out vec4 fragColor;
  uniform sampler2D uTex;
  uniform float uN;
  uniform vec2 uRes;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  void main(){
    vec3 c = max(texture(uTex, gl_FragCoord.xy / uRes).rgb / max(uN, 1.0), 0.0);
    c = aces(c * 1.1);
    c = pow(c, vec3(1.0/2.2));
    fragColor = vec4(c, 1.0);
  }
`

function BenchScene({ aperture, focus, fov, disp, spinning, subject, ior, tint, lightCount, yaw, pitch, orbitR }: { aperture: number; focus: number; fov: number; disp: number; spinning: boolean; subject: string | null; ior: number; tint: string; lightCount: number; yaw: number; pitch: number; orbitR: number }) {
  const { gl, size } = useThree()
  const invalidate = useThree((s) => s.invalidate)
  const dpr = Math.min(gl.getPixelRatio(), 2)
  const w = Math.max(2, Math.round(size.width * dpr))
  const h = Math.max(2, Math.round(size.height * dpr))
  const accum = useFBO(w, h, { type: THREE.FloatType, depthBuffer: false })

  const frag = useMemo(() => makeFrag(subject ? sdfActiveGLSL(subject) : '', !!subject), [subject])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    uniforms: {
      uRes: { value: new THREE.Vector2(w, h) }, uSeed: { value: 0 },
      uAperture: { value: aperture }, uFocus: { value: focus }, uFov: { value: fov }, uDisp: { value: disp }, uSpin: { value: 0 },
      uIor: { value: ior }, uSubjScale: { value: 1.35 }, uTint: { value: new THREE.Color(1, 1, 1) }, uLightCount: { value: lightCount },
      uYaw: { value: yaw }, uPitch: { value: pitch }, uOrbitR: { value: orbitR },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [w, h, frag])
  const dispMat = useMemo(() => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DISP, depthTest: false, depthWrite: false,
    uniforms: { uTex: { value: accum.texture }, uN: { value: 1 }, uRes: { value: new THREE.Vector2(w, h) } },
  }), [accum, w, h])
  const quad = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
  const ptScene = useMemo(() => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, mat)); return s }, [quad, mat])
  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
  const frame = useRef(0)
  const lastKey = useRef('')
  const spin = useRef(0)
  const lastT = useRef(performance.now())

  // The accumulation trace runs to the off-screen FBO in useFrame; the DISPLAY is a real R3F mesh (below) that R3F
  // draws to the screen each frame, sampling the accum texture — so R3F's own render doesn't clear our image.
  useFrame(() => {
    const now = performance.now(); const dt = Math.min(0.05, (now - lastT.current) / 1000); lastT.current = now
    if (spinning) spin.current += dt * 0.35 // auto-orbit: advance the camera yaw
    const u = mat.uniforms
    u.uRes.value.set(w, h); u.uAperture.value = aperture; u.uFocus.value = focus; u.uFov.value = fov; u.uDisp.value = disp; u.uSpin.value = 0
    u.uIor.value = ior; u.uLightCount.value = lightCount
    u.uYaw.value = yaw + spin.current; u.uPitch.value = pitch; u.uOrbitR.value = orbitR // camera orbits the subject
    ;(u.uTint.value as THREE.Color).set(tint).convertSRGBToLinear()
    // reset the accumulation whenever any control (or the orbit) changes; otherwise let it converge to a clean,
    // low-noise image (bokeh + CA need many aperture/wavelength samples).
    const key = `${subject ?? ''}|${aperture.toFixed(3)}|${focus.toFixed(3)}|${fov.toFixed(3)}|${disp.toFixed(3)}|${(yaw + spin.current).toFixed(3)}|${pitch.toFixed(3)}|${orbitR.toFixed(2)}|${ior.toFixed(2)}|${tint}|${lightCount}|${w}x${h}`
    if (key !== lastKey.current) {
      lastKey.current = key; frame.current = 0
      const pc = gl.getClearColor(new THREE.Color()).getHex(); const pa = gl.getClearAlpha()
      gl.setRenderTarget(accum); gl.setClearColor(0x000000, 0); gl.clear(true, false, false); gl.setClearColor(pc, pa)
    }
    const converged = !spinning && frame.current >= 200
    if (!converged) {
      u.uSeed.value = frame.current
      const pAuto = gl.autoClear; gl.autoClear = false
      gl.setRenderTarget(accum); gl.render(ptScene, ortho); gl.autoClear = pAuto
      frame.current++
    }
    gl.setRenderTarget(null) // hand the framebuffer back to R3F, which draws the display mesh below
    dispMat.uniforms.uN.value = frame.current; dispMat.uniforms.uTex.value = accum.texture; dispMat.uniforms.uRes.value.set(w, h)
    if (!converged) invalidate()
  }, -1)

  return (
    <mesh frustumCulled={false}>
      <primitive object={quad} attach="geometry" />
      <primitive object={dispMat} attach="material" />
    </mesh>
  )
}

// A simple side-view SCHEMATIC of the optical path (sensor · aperture/lens · focus plane · scene), drawn from the
// live controls — so the "camera lens + aperture + sensor" reads as physical components, not just sliders.
function OpticsDiagram({ aperture, focus, fov }: { aperture: number; focus: number; fov: number }) {
  const W = 300, H = 120, lensX = 46, sensorX = 22
  const halfAp = 6 + aperture * 34 // aperture opening (px)
  const focusX = lensX + Math.min(240, (focus / 13.5) * (W - lensX - 10))
  const fovHalf = 8 + fov * 0 + 30 // sensor half-height for the cone
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: 'rgba(10,11,22,0.5)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
      {/* rays from sensor edges through the aperture to the focus plane */}
      {[-1, 1].map((s) => (
        <g key={s} stroke="rgba(120,200,255,0.5)" strokeWidth="1" fill="none">
          <line x1={sensorX} y1={H / 2 - s * fovHalf} x2={lensX} y2={H / 2 - s * halfAp} />
          <line x1={lensX} y1={H / 2 - s * halfAp} x2={focusX} y2={H / 2} />
        </g>
      ))}
      {/* sensor plane */}
      <line x1={sensorX} y1={H / 2 - fovHalf - 4} x2={sensorX} y2={H / 2 + fovHalf + 4} stroke="#e7ecff" strokeWidth="3" />
      <text x={sensorX} y={H - 6} fontSize="9" fill="#9aa0b5" textAnchor="middle">sensor</text>
      {/* lens (two arcs) + aperture opening */}
      <path d={`M ${lensX} ${H / 2 - halfAp} Q ${lensX + 9} ${H / 2} ${lensX} ${H / 2 + halfAp} Q ${lensX - 9} ${H / 2} ${lensX} ${H / 2 - halfAp} Z`} fill="rgba(150,220,255,0.22)" stroke="#5fe0c6" strokeWidth="1.5" />
      <text x={lensX} y={H - 6} fontSize="9" fill="#9aa0b5" textAnchor="middle">lens + aperture</text>
      {/* focus plane */}
      <line x1={focusX} y1={20} x2={focusX} y2={H - 24} stroke="#ffcf6b" strokeWidth="1.5" strokeDasharray="3 3" />
      <text x={focusX} y={16} fontSize="9" fill="#ffcf6b" textAnchor="middle">focus</text>
    </svg>
  )
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-text-secondary, #c7ccdd)', marginBottom: 4 }}>
        <span>{label}</span><span style={{ color: 'var(--c-accent-teal, #5fe0c6)', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: '100%' }} />
    </label>
  )
}

// Subjects the camera can photograph — the SDF families (raymarchable), a curated selection first, then the rest.
const prettify = (f: string) => f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const FEATURED = ['lens', 'icosahedron', 'dodecahedron', 'octahedron', 'sphere', 'torus', 'trefoil', 'gyroid', 'klein_quartic', 'menger', 'spike', 'mobius', 'ditorus']
const SUBJECTS = [...FEATURED.filter((f) => SDF_FAMILIES.includes(f)), ...SDF_FAMILIES.filter((f) => !FEATURED.includes(f)).sort()]
const TINTS = ['#ffffff', '#ff6b8f', '#ffcf6b', '#7dff8a', '#5fe0c6', '#6ca0ff', '#b985ff']

export function OpticsBench() {
  const [aperture, setAperture] = useState(0.28)
  const [focus, setFocus] = useState(6.0)
  const [fov, setFov] = useState(1.7)
  const [disp, setDisp] = useState(0.35)
  const [spinning, setSpinning] = useState(true)
  const [subject, setSubject] = useState<string | null>('icosahedron')
  const [ior, setIor] = useState(1.5)
  const [tint, setTint] = useState('#ffffff')
  const [lightCount, setLightCount] = useState(30)
  const [yaw, setYaw] = useState(0)
  const [pitch, setPitch] = useState(0.12)
  const [orbitR, setOrbitR] = useState(6.0)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY } }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
    setYaw((y) => y - dx * 0.006)
    setPitch((p) => Math.max(-1.35, Math.min(1.35, p - dy * 0.006)))
  }
  const onUp = () => { drag.current = null }
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#05060d', color: 'var(--c-text, #e7ecff)', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ flex: 1, position: 'relative', cursor: 'grab' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <Canvas frameloop="always" gl={{ antialias: false, powerPreference: 'high-performance' }} style={{ position: 'absolute', inset: 0 }}>
          <BenchScene aperture={aperture} focus={focus} fov={fov} disp={disp} spinning={spinning} subject={subject} ior={ior} tint={tint} lightCount={lightCount} yaw={yaw} pitch={pitch} orbitR={orbitR} />
        </Canvas>
        <div style={{ position: 'absolute', top: 14, left: 16 }}>
          <button onClick={() => { location.href = '?viewer' }} style={{ background: 'rgba(10,11,22,0.6)', color: '#c7ccdd', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>← Shape Viewer</button>
        </div>
        <div style={{ position: 'absolute', bottom: 14, left: 16, fontSize: 12, color: '#8a90a6', maxWidth: 540, lineHeight: 1.5 }}>
          A thin-lens camera photographing a glass <strong style={{ color: '#c7ccdd' }}>subject</strong> that refracts a rainbow helix of point lights. <strong style={{ color: '#c7ccdd' }}>Drag</strong> to orbit the camera. Open the <strong style={{ color: '#c7ccdd' }}>aperture</strong> for shallow depth-of-field + big bokeh; move <strong style={{ color: '#c7ccdd' }}>focus</strong> to sweep the sharp plane; crank <strong style={{ color: '#c7ccdd' }}>chromatic aberration</strong> to split each colour's focus.
        </div>
      </main>
      <aside style={{ width: 304, padding: '22px 20px', background: 'rgba(12,13,26,0.9)', borderLeft: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto' }}>
        <strong style={{ fontSize: 17 }}>Optics Bench</strong>
        <p style={{ fontSize: 12, color: '#8a90a6', margin: '4px 0 16px' }}>lens · aperture · sensor — a light-transport testbed</p>
        <OpticsDiagram aperture={aperture} focus={focus} fov={fov} />
        <div style={{ height: 16 }} />

        <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: '#7a809a', marginBottom: 8 }}>Camera</div>
        <Slider label="Aperture (f-stop)" value={aperture} min={0} max={0.7} step={0.005} onChange={setAperture} fmt={(v) => (v < 0.01 ? 'pinhole' : `f/${(1 / (v * 2.6)).toFixed(1)}`)} />
        <Slider label="Focus distance" value={focus} min={2.6} max={13} step={0.05} onChange={setFocus} fmt={(v) => `${v.toFixed(1)} u`} />
        <Slider label="Focal length (FOV)" value={fov} min={0.9} max={3.2} step={0.02} onChange={setFov} fmt={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Chromatic aberration" value={disp} min={0} max={1.2} step={0.01} onChange={setDisp} fmt={(v) => (v < 0.01 ? 'off' : v.toFixed(2))} />

        <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: '#7a809a', margin: '18px 0 8px' }}>Subject</div>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#c7ccdd', marginBottom: 4 }}>Shape</div>
          <select value={subject ?? ''} onChange={(e) => setSubject(e.target.value || null)} style={{ width: '100%', padding: '7px 8px', background: 'rgba(10,11,22,0.7)', color: '#e7ecff', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, fontSize: 13 }}>
            <option value="">None (lights only)</option>
            {SUBJECTS.map((f) => <option key={f} value={f}>{prettify(f)}</option>)}
          </select>
        </label>
        {subject && (
          <>
            {/* moving the subject also refocuses on it (so it stays sharp); tweak the Focus slider to defocus it */}
            <Slider label="Distance to subject" value={orbitR} min={3} max={11} step={0.05} onChange={(v) => { setOrbitR(v); setFocus(v) }} fmt={(v) => `${v.toFixed(1)} u`} />
            <Slider label="Index of refraction" value={ior} min={1.0} max={2.6} step={0.01} onChange={setIor} fmt={(v) => v.toFixed(2)} />
            <div style={{ fontSize: 12, color: '#c7ccdd', marginBottom: 6 }}>Body tint</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {TINTS.map((t) => (
                <button key={t} onClick={() => setTint(t)} title={t} style={{ width: 26, height: 26, borderRadius: 6, background: t, border: tint === t ? '2px solid #5fe0c6' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }} />
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: '#7a809a', margin: '4px 0 8px' }}>Scene</div>
        <Slider label="Light particles" value={lightCount} min={0} max={30} step={1} onChange={setLightCount} fmt={(v) => `${v}`} />
        <button onClick={() => setSpinning((s) => !s)} style={{ width: '100%', marginTop: 4, background: spinning ? 'rgba(95,224,198,0.16)' : 'rgba(10,11,22,0.6)', color: spinning ? '#5fe0c6' : '#c7ccdd', border: '1px solid rgba(95,224,198,0.4)', borderRadius: 8, padding: '8px', cursor: 'pointer', fontSize: 13 }}>
          ↻ Auto-orbit camera · {spinning ? 'on' : 'off (converging still)'}
        </button>
      </aside>
    </div>
  )
}
