// ── SDF shape library, per-shape ──────────────────────────────────────────────────────────────────────────
// CRITICAL: each shader must contain ONLY the shape(s) it actually renders. Cramming all ~25 fields into one
// program (the old monolithic `sdfShape(p,int)` dispatcher) overran the GPU's program limit → the program
// failed to link ("VALIDATE_STATUS false") and the page froze. So we emit per-shape GLSL: the hero injects ONE
// shape; the (future) Orrery scene tracer injects only the DISTINCT shapes actually on the board. Pure float
// math (GLSL ES 1.00) so it's valid on every driver. Helpers are shared strings, included only when needed.

const H_BOX = /* glsl */ `
  float sdfBox(vec3 p, vec3 b){ vec3 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0); }`

// Menger sponge — exact distance (Iñigo Quílez): box minus three axis-aligned cross tubes per level, ×3 each iter.
const H_MENGER = /* glsl */ `${H_BOX}
  float sdfMenger(vec3 p, int iters){
    float d = sdfBox(p, vec3(1.0));
    float s = 1.0;
    for(int m=0;m<6;m++){
      if(m>=iters) break;
      vec3 a = mod(p*s, 2.0) - 1.0;
      s *= 3.0;
      vec3 r = abs(1.0 - 3.0*abs(a));
      float cr = (min(max(r.x,r.y), min(max(r.y,r.z), max(r.z,r.x))) - 1.0) / s;
      d = max(d, cr);
    }
    return d;
  }`

// Sierpiński tetrahedron — exact distance via fold-toward-nearest-vertex, ×2 each iter.
const H_SIERP = /* glsl */ `
  float sdfSierpinski(vec3 p, int iters){
    vec3 a1=vec3(1.,1.,1.), a2=vec3(-1.,-1.,1.), a3=vec3(1.,-1.,-1.), a4=vec3(-1.,1.,-1.);
    float scale = 2.0; vec3 c; float dist; float dd;
    for(int n=0;n<9;n++){
      if(n>=iters) break;
      c=a1; dist=length(p-a1);
      dd=length(p-a2); if(dd<dist){ c=a2; dist=dd; }
      dd=length(p-a3); if(dd<dist){ c=a3; dist=dd; }
      dd=length(p-a4); if(dd<dist){ c=a4; dist=dd; }
      p = scale*p - c*(scale-1.0);
    }
    return length(p) * pow(scale, -float(iters));
  }`

// (P,Q) torus knot — analytic cross-section approximation, scaled ×0.5 so it stays a safe under-bound.
const H_KNOT = /* glsl */ `
  float sdfTorusKnot(vec3 p, float P, float Q){
    float R=0.6, r2=0.26, tube=0.12;
    float theta = atan(p.z, p.x);
    vec2 cs = vec2(length(p.xz) - R, p.y);
    float best = 1e9;
    int Pi = int(P + 0.5);
    for(int k=0;k<8;k++){
      if(k>=Pi) break;
      float t = (theta + 6.2831853*float(k)) / P;
      float psi = Q * t;
      best = min(best, length(cs - r2*vec2(cos(psi), sin(psi))));
    }
    return (best - tube) * 0.5;
  }`

// Klein quartic — genus 3 with maximal (tetrahedral-extended) symmetry. The actual algebraic surface has no
// closed-form SDF, so we use a mathematically-honest stand-in: a thickened TETRAHEDRON FRAME. A thickened graph
// has genus E−V+1, and the tetrahedron skeleton (6 edges, 4 vertices) gives 6−4+1 = 3 — a real genus-3 surface
// with tetrahedral symmetry (the symmetry group of the canonical "Eightfold Way" embedding). Smooth-min'd edges
// read as a single sculptural shell, not six sticks. Same field is sampled for the mesh in geometry.ts.
const H_KLEIN = /* glsl */ `
  float kqSeg(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
  float kqMin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
  float sdfKleinQuartic(vec3 p){
    vec3 v0=vec3(0.55,0.55,0.55), v1=vec3(0.55,-0.55,-0.55), v2=vec3(-0.55,0.55,-0.55), v3=vec3(-0.55,-0.55,0.55);
    float r=0.26, k=0.08;
    float d=kqSeg(p,v0,v1,r);
    d=kqMin(d,kqSeg(p,v0,v2,r),k); d=kqMin(d,kqSeg(p,v0,v3,r),k);
    d=kqMin(d,kqSeg(p,v1,v2,r),k); d=kqMin(d,kqSeg(p,v1,v3,r),k); d=kqMin(d,kqSeg(p,v2,v3,r),k);
    return d;
  }`

// Stanford Bunny — SIREN neural-network SDF © Blackle Mori, CC0 (shadertoy.com/view/wtVyWK); raytk orientation.
// Valid only inside the unit sphere (outside → bounding sphere that funnels the ray in).
const H_BUNNY = /* glsl */ `
  float sdfBunny(vec3 p){
    if (length(p) > 1.) return length(p)-.8;
    p = vec3(-p.x, -p.z, p.y);
    vec4 f00=sin(p.y*vec4(-3.02,1.95,-3.42,-.60)+p.z*vec4(3.08,.85,-2.25,-.24)-p.x*vec4(-.29,1.16,-3.74,2.89)+vec4(-.71,4.50,-3.24,-3.50));
    vec4 f01=sin(p.y*vec4(-.40,-3.61,3.23,-.14)+p.z*vec4(-.36,3.64,-3.91,2.66)-p.x*vec4(2.90,-.54,-2.75,2.71)+vec4(7.02,-5.41,-1.12,-7.41));
    vec4 f02=sin(p.y*vec4(-1.77,-1.28,-4.29,-3.20)+p.z*vec4(-3.49,-2.81,-.64,2.79)-p.x*vec4(3.15,2.14,-3.85,1.83)+vec4(-2.07,4.49,5.33,-2.17));
    vec4 f03=sin(p.y*vec4(-.49,.68,3.05,.42)+p.z*vec4(-2.87,.78,3.78,-3.41)-p.x*vec4(-2.65,.33,.07,-.64)+vec4(-3.24,-5.90,1.14,-4.71));
    vec4 f10=sin(mat4(-.34,.06,-.59,-.76,.10,-.19,-.12,.44,.64,-.02,-.26,.15,-.16,.21,.91,.15)*f00+
        mat4(.01,.54,-.77,.11,.06,-.14,.43,.51,-.18,.08,.39,.20,.33,-.49,-.10,.19)*f01+
        mat4(.27,.22,.43,.53,.18,-.17,.23,-.64,-.14,.02,-.10,.16,-.13,-.06,-.04,-.36)*f02+
        mat4(-.13,.29,-.29,.08,1.13,.02,-.83,.32,-.32,.04,-.31,-.16,.14,-.03,-.20,.39)*f03+
        vec4(.73,-4.28,-1.56,-1.80))/1.0+f00;
    vec4 f11=sin(mat4(-1.11,.55,-.12,-1.00,.16,.15,-.30,.31,-.01,.01,.31,-.42,-.29,.38,-.04,.71)*f00+
        mat4(.96,-.02,.86,.52,-.14,.60,.44,.43,.02,-.15,-.49,-.05,-.06,-.25,-.03,-.22)*f01+
        mat4(.52,.44,-.05,-.11,-.56,-.10,-.61,-.40,-.04,.55,.32,-.07,-.02,.28,.26,-.49)*f02+
        mat4(.02,-.32,.06,-.17,-.59,.00,-.24,.60,-.06,.13,-.21,-.27,-.12,-.14,.58,-.55)*f03+
        vec4(-2.24,-3.48,-.80,1.41))/1.0+f01;
    vec4 f12=sin(mat4(.44,-.06,-.79,-.46,.05,-.60,.30,.36,.35,.12,.02,.12,.40,-.26,.63,-.21)*f00+
        mat4(-.48,.43,-.73,-.40,.11,-.01,.71,.05,-.25,.25,-.28,-.20,.32,-.02,-.84,.16)*f01+
        mat4(.39,-.07,.90,.36,-.38,-.27,-1.86,-.39,.48,-.20,-.05,.10,-.00,-.21,.29,.63)*f02+
        mat4(.46,-.32,.06,.09,.72,-.47,.81,.78,.90,.02,-.21,.08,-.16,.22,.32,-.13)*f03+
        vec4(3.38,1.20,.84,1.41))/1.0+f02;
    vec4 f13=sin(mat4(-.41,-.24,-.71,-.25,-.24,-.75,-.09,.02,-.27,-.42,.02,.03,-.01,.51,-.12,-1.24)*f00+
        mat4(.64,.31,-1.36,.61,-.34,.11,.14,.79,.22,-.16,-.29,-.70,.02,-.37,.49,.39)*f01+
        mat4(.79,.47,.54,-.47,-1.13,-.35,-1.03,-.22,-.67,-.26,.10,.21,-.07,-.73,-.11,.72)*f02+
        mat4(.43,-.23,.13,.09,1.38,-.63,1.57,-.20,.39,-.14,.42,.13,-.57,-.08,-.21,.21)*f03+
        vec4(-.34,-3.28,.43,-.52))/1.0+f03;
    f00=sin(mat4(-.72,.23,-.89,.52,.38,.19,-.16,-.88,.26,-.37,.09,.63,.29,-.72,.30,-.95)*f10+
        mat4(-.22,-.51,-.42,-.73,-.32,.00,-1.03,1.17,-.20,-.03,-.13,-.16,-.41,.09,.36,-.84)*f11+
        mat4(-.21,.01,.33,.47,.05,.20,-.44,-1.04,.13,.12,-.13,.31,.01,-.34,.41,-.34)*f12+
        mat4(-.13,-.06,-.39,-.22,.48,.25,.24,-.97,-.34,.14,.42,-.00,-.44,.05,.09,-.95)*f13+
        vec4(.48,.87,-.87,-2.06))/1.4+f10;
    f01=sin(mat4(-.27,.29,-.21,.15,.34,-.23,.85,-.09,-1.15,-.24,-.05,-.25,-.12,-.73,-.17,-.37)*f10+
        mat4(-1.11,.35,-.93,-.06,-.79,-.03,-.46,-.37,.60,-.37,-.14,.45,-.03,-.21,.02,.59)*f11+
        mat4(-.92,-.17,-.58,-.18,.58,.60,.83,-1.04,-.80,-.16,.23,-.11,.08,.16,.76,.61)*f12+
        mat4(.29,.45,.30,.39,-.91,.66,-.35,-.35,.21,.16,-.54,-.63,1.10,-.38,.20,.15)*f13+
        vec4(-1.72,-.14,1.92,2.08))/1.4+f11;
    f02=sin(mat4(1.00,.66,1.30,-.51,.88,.25,-.67,.03,-.68,-.08,-.12,-.14,.46,1.15,.38,-.10)*f10+
        mat4(.51,-.57,.41,-.09,.68,-.50,-.04,-1.01,.20,.44,-.60,.46,-.09,-.37,-1.30,.04)*f11+
        mat4(.14,.29,-.45,-.06,-.65,.33,-.37,-.95,.71,-.07,1.00,-.60,-1.68,-.20,-.00,-.70)*f12+
        mat4(-.31,.69,.56,.13,.95,.36,.56,.59,-.63,.52,-.30,.17,1.23,.72,.95,.75)*f13+
        vec4(-.90,-3.26,-.44,-3.11))/1.4+f12;
    f03=sin(mat4(.51,-.98,-.28,.16,-.22,-.17,-1.03,.22,.70,-.15,.12,.43,.78,.67,-.85,-.25)*f10+
        mat4(.81,.60,-.89,.61,-1.03,-.33,.60,-.11,-.06,.01,-.02,-.44,.73,.69,1.02,.62)*f11+
        mat4(-.10,.52,.80,-.65,.40,-.75,.47,1.56,.03,.05,.08,.31,-.03,.22,-1.63,.07)*f12+
        mat4(-.18,-.07,-1.22,.48,-.01,.56,.07,.15,.24,.25,-.09,-.54,.23,-.08,.20,.36)*f13+
        vec4(-1.11,-4.28,1.02,-.23))/1.4+f13;
    return dot(f00,vec4(.09,.12,-.07,-.03))+dot(f01,vec4(-.04,.07,-.08,.05))+
        dot(f02,vec4(-.01,.06,-.02,.07))+dot(f03,vec4(-.05,.07,.03,.04))-0.16;
  }`

// Mandelbulb power-8 distance estimator — raytk's mandelbulbSdf.glsl (canonical Quílez DE), xzy axis order.
const H_MANDEL = /* glsl */ `
  float sdfMandelbulb(vec3 p){
    float power = 8.0;
    p = p.xzy;
    vec3 w = p;
    float m = dot(w, w);
    float dz = 1.0;
    for(int i=0;i<15;i++){
      dz = power*pow(sqrt(m), power-1.0)*dz + 1.0;
      float r = length(w);
      float theta = power*acos(clamp(w.y/r, -1.0, 1.0));
      float phi = power*atan(w.x, w.z);
      w = p + pow(r, power)*vec3(sin(theta)*sin(phi), cos(theta), sin(theta)*cos(phi));
      m = dot(w, w);
      if(m > 256.0) break;
    }
    return 0.25*log(m)*sqrt(m)/dz;
  }`

// Double helix — two intertwined tubes wound around Y (sdf-explorer/Geometry/Helix).
const H_HELIX = /* glsl */ `
  float sdfHelix(vec3 p){
    float pitch = 0.42, R = 0.42, tube = 0.085;
    float a = atan(p.z, p.x);
    float rxz = length(p.xz);
    float best = 1e9;
    for(int s=0;s<2;s++){
      float off = float(s)*3.14159265;
      float k = floor((p.y/pitch - a - off)/6.2831853 + 0.5);
      float ay = pitch*(a + off + 6.2831853*k);
      best = min(best, length(vec2(rxz - R, p.y - ay)));
    }
    return best - tube;
  }`

// Möbius strip — a half-twisting band orbiting Y (non-orientable).
const H_MOBIUS = /* glsl */ `
  float sdfMobius(vec3 p){
    float R = 0.62, w = 0.42, th = 0.06;
    float a = atan(p.z, p.x);
    float r = length(p.xz) - R;
    float c = cos(a*0.5), s = sin(a*0.5);
    float u = c*r + s*p.y;
    float v = -s*r + c*p.y;
    vec2 d = abs(vec2(u, v)) - vec2(w, th);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }`

// Spike — a sphere pushed out along the ±axes into sharp points (caltrop/urchin).
const H_SPIKE = /* glsl */ `
  float sdfSpike(vec3 p){
    vec3 n = normalize(p + 1e-5);
    float m = max(abs(n.x), max(abs(n.y), abs(n.z)));
    float spike = pow(m, 6.0);
    return (length(p) - (0.5 + 0.55*spike)) * 0.55;
  }`

// Exact convex-polyhedron SDFs: max of the signed face-plane distances (= true distance outside, correct sign
// inside). Dodeca/icosa are centrally symmetric, so abs(dot(p,n)) covers each opposite face pair — only the
// unique normal DIRECTIONS are needed (Mercury hg_sdf "generalized distance functions"; 2.618034 = φ+1).
const H_PLATONIC = /* glsl */ `
  float sdIcosa(vec3 p, float r){
    float d=abs(dot(p,normalize(vec3(1.,1.,1.))));
    d=max(d,abs(dot(p,normalize(vec3(-1.,1.,1.)))));
    d=max(d,abs(dot(p,normalize(vec3(1.,-1.,1.)))));
    d=max(d,abs(dot(p,normalize(vec3(1.,1.,-1.)))));
    d=max(d,abs(dot(p,normalize(vec3(0.,1.,2.618034)))));
    d=max(d,abs(dot(p,normalize(vec3(0.,-1.,2.618034)))));
    d=max(d,abs(dot(p,normalize(vec3(2.618034,0.,1.)))));
    d=max(d,abs(dot(p,normalize(vec3(-2.618034,0.,1.)))));
    d=max(d,abs(dot(p,normalize(vec3(1.,2.618034,0.)))));
    d=max(d,abs(dot(p,normalize(vec3(-1.,2.618034,0.)))));
    return d-r;
  }
  float sdDodeca(vec3 p, float r){
    float d=abs(dot(p,normalize(vec3(0.,1.,2.618034))));
    d=max(d,abs(dot(p,normalize(vec3(0.,-1.,2.618034)))));
    d=max(d,abs(dot(p,normalize(vec3(2.618034,0.,1.)))));
    d=max(d,abs(dot(p,normalize(vec3(-2.618034,0.,1.)))));
    d=max(d,abs(dot(p,normalize(vec3(1.,2.618034,0.)))));
    d=max(d,abs(dot(p,normalize(vec3(-1.,2.618034,0.)))));
    return d-r;
  }`

// Exact capped cylinder + capped cone (Iñigo Quílez). h = half-height; cone tapers r1 (bottom) → r2 (top).
const H_CYLCONE = /* glsl */ `
  float sdCyl(vec3 p, float h, float r){ vec2 d=abs(vec2(length(p.xz),p.y))-vec2(r,h); return min(max(d.x,d.y),0.0)+length(max(d,0.0)); }
  float sdCone(vec3 p, float h, float r1, float r2){
    vec2 q=vec2(length(p.xz),p.y);
    vec2 k1=vec2(r2,h); vec2 k2=vec2(r2-r1,2.0*h);
    vec2 ca=vec2(q.x-min(q.x,(q.y<0.0)?r1:r2),abs(q.y)-h);
    vec2 cb=q-k1+k2*clamp(dot(k1-q,k2)/dot(k2,k2),0.0,1.0);
    float s=(cb.x<0.0&&ca.y<0.0)?-1.0:1.0;
    return s*sqrt(min(dot(ca,ca),dot(cb,cb)));
  }`

// Genus surfaces & links — smooth-min of tori (matches the mesh stand-ins mergedTori/linkedRings: N coplanar
// rings for genus-N, three mutually-perpendicular rings for the Borromean link). kgTorZ = a ring in the XY
// plane (axis Z) shifted along X; smooth-min fuses neighbours into one shell while the holes stay open.
const H_GENUS = /* glsl */ `
  float kgMin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
  float kgTorZ(vec3 p, float cx, float rr, float t){ p.x-=cx; return length(vec2(length(p.xy)-rr,p.z))-t; }`

// Iconic "bottle" Klein bottle (immersed thin shell) — min of analytic parts: neck tube, opening, body torus,
// handle. Adapted from a Shadertoy SDF (sky/render scaffolding stripped). Self-intersects (the neck passes
// through the wall) — that IS the Klein bottle in 3-space; matches the Bourke "bottle" mesh in geometry.ts.
const H_KLEINB = /* glsl */ `
  mat2 kbRot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
  float sdfKleinBottle(vec3 p){
    float t = 0.09;
    float d = 1e10;
    p.y += 0.5;
    p.xy = kbRot(1.5707963) * p.xy;
    vec3 q = p + vec3(1.0-cos((1.0-p.y)/3.0*3.1415926),0.0,0.0);
    float y = pow(sin((1.0-p.y)/3.0*3.1415926/2.0),2.0);
    float tube_hollow = max(max(abs(length(q.xz)-0.5+0.25*y)-t,q.y-1.0),-q.y-2.0);
    float tube_solid  = max(max(length(q.xz)-0.5+0.25*y,q.y-1.0),-q.y-2.0);
    q = p - vec3(0.0,1.0,0.0);
    d = min(d, max(abs(length(vec2(length(q.xz)-1.0,q.y))-0.5)-t,-q.y));
    q = p;
    d = min(d, max(max(max(abs(length(q.xz)-1.5+1.25*y),q.y-1.0),-q.y-2.0)-t,-tube_solid));
    d = min(d, tube_hollow);
    q = p + vec3(1.0,2.0,0.0);
    d = min(d, max(abs(length(vec2(length(q.xy)-1.0,q.z))-0.25)-t,q.y));
    return d;
  }`

// Triply-periodic minimal surface (gyroid/Schwarz-P/-D), intersected with a sphere → a finite "crystal".
const tpms = (g: string) => `float fr=3.0; vec3 s=sin(p*fr), c=cos(p*fr); float gg=${g}; return max(abs(gg)/fr*0.5 - 0.055, length(p)-1.18);`

// Compact value noise (IQ's integer hash + trilinear smoothstep interp) → fbm displacement for mazur, the
// "monster": a sphere pushed around by 2 octaves of noise (IQ's opDisplace). Still genus-0/contractible — just
// a deformed ball, so the topology joke survives while it finally LOOKS like a lumpy rock.
const H_MAZUR = /* glsl */ `
  float mzHash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float mzNoise(vec3 x){
    vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(mzHash(i+vec3(0.0,0.0,0.0)),mzHash(i+vec3(1.0,0.0,0.0)),f.x),
                   mix(mzHash(i+vec3(0.0,1.0,0.0)),mzHash(i+vec3(1.0,1.0,0.0)),f.x),f.y),
               mix(mix(mzHash(i+vec3(0.0,0.0,1.0)),mzHash(i+vec3(1.0,0.0,1.0)),f.x),
                   mix(mzHash(i+vec3(0.0,1.0,1.0)),mzHash(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z);
  }`

// ── Fractal distance estimators (the "cool" showpiece SDFs) ──────────────────────────────────────────────
// Mandelbox — Rrrola's compact DE (box-fold + sphere-fold, scale 2.7). The architectural cousin of the Mandelbulb.
const H_MBOX = /* glsl */ `
  float sdfMandelbox(vec3 pos){
    float SC=2.7, MR2=0.25;
    vec4 sv=vec4(SC,SC,SC,abs(SC))/MR2;
    float C1=abs(SC-1.0), C2=pow(abs(SC),-9.0);
    vec4 p=vec4(pos,1.0), p0=p;
    for(int i=0;i<10;i++){
      p.xyz=clamp(p.xyz,-1.0,1.0)*2.0-p.xyz;
      float r2=dot(p.xyz,p.xyz);
      p*=clamp(max(MR2/r2,MR2),0.0,1.0);
      p=p*sv+p0;
    }
    return (length(p.xyz)-C1)/p.w-C2;
  }`

// Quaternion Julia — a 4D Julia set sliced to 3D; the seed c picks the shape. Classic Hart/Quílez DE.
const H_JULIA = /* glsl */ `
  float sdfJulia(vec3 pos){
    vec4 z=vec4(pos,0.0);
    vec4 c=vec4(-0.45,0.3,0.5,-0.2);
    float dz2=1.0;
    for(int i=0;i<9;i++){
      dz2*=4.0*dot(z,z);
      z=vec4(z.x*z.x-dot(z.yzw,z.yzw), 2.0*z.x*z.yzw)+c;
      if(dot(z,z)>6.0) break;
    }
    float z2=dot(z,z);
    return 0.25*sqrt(z2/dz2)*log(max(z2,1e-12));
  }`

// Apollonian gasket — recursive sphere inversions in a folded cell; crystalline nested bubbles (Quílez). Bounded.
const H_APOLLO = /* glsl */ `
  float sdfApollonian(vec3 p){
    float s=1.0;
    for(int i=0;i<8;i++){
      p=-1.0+2.0*fract(0.5*p+0.5);
      float r2=dot(p,p);
      float k=1.15/max(r2,1e-4);
      p*=k; s*=k;
    }
    return 0.25*abs(p.y)/s;
  }`

// Pseudo-Kleinian — knighty's fold fractal: box-fold to a cell + sphere-fold, "alien cathedral". Bounded.
const H_KLEINIAN = /* glsl */ `
  float sdfKleinian(vec3 p){
    float s=1.0;
    vec3 CS=vec3(0.92436,0.90756,0.92436);
    for(int i=0;i<8;i++){
      p=2.0*clamp(p,-CS,CS)-p;
      float k=max(0.70968/max(dot(p,p),1e-4),1.0);
      p*=k; s*=k;
    }
    float r=length(p.xy);
    return 0.7*max(r-0.92784, abs(r*p.z)/max(length(p),1e-4))/s;
  }`

// Twisted torus — a flattened "ribbon" cross-section spun 2× as it travels around the ring (twisting a CIRCULAR
// torus around its own axis is invisible — it's rotationally symmetric — so the twist must vary with the ring
// angle). 2 turns ⇒ the orientation returns to itself at the atan seam, so it stays closed & continuous.
const H_TWISTTORUS = /* glsl */ `
  float sdfTwistTorus(vec3 p){
    float R=0.6;
    float an=atan(p.z,p.x);
    vec2 cs=vec2(length(p.xz)-R, p.y);
    float a=2.0*an, c=cos(a), s=sin(a);
    cs=mat2(c,-s,s,c)*cs;
    return (length(vec2(cs.x*0.55, cs.y))-0.16)*0.7;
  }`

// Cut hollow sphere — IQ's exact bowl/shell (the formula you pasted): a spherical shell sliced at height h,
// thickness t, with a rounded rim. Open surface (renders double-sided).
const H_CUTHOLLOW = /* glsl */ `
  float sdfCutHollow(vec3 p, float r, float h, float t){
    float w=sqrt(r*r-h*h);
    vec2 q=vec2(length(p.xz), p.y);
    return ((h*q.x<w*q.y)? length(q-vec2(w,h)) : abs(length(q)-r)) - t;
  }`

// Blobby — fogleman/sdf's blob: a central sphere smooth-unioned with three axis "dumbbells" (a thin rod capped
// by two fatter balls), one per X/Y/Z. Octahedral symmetry, genus 0, organic bulging. Scaled to ~unit.
const H_BLOBBY = /* glsl */ `
  float bSeg(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
  float bMin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
  float sdfBlobby(vec3 p){
    float k=0.28, R=0.42, A=0.8, rod=0.14, ball=0.2;
    float d=length(p)-R;
    d=bMin(d, bSeg(p, vec3(-A,0.0,0.0), vec3(A,0.0,0.0), rod), k);
    d=bMin(d, length(p-vec3(A,0.0,0.0))-ball, k); d=bMin(d, length(p-vec3(-A,0.0,0.0))-ball, k);
    d=bMin(d, bSeg(p, vec3(0.0,-A,0.0), vec3(0.0,A,0.0), rod), k);
    d=bMin(d, length(p-vec3(0.0,A,0.0))-ball, k); d=bMin(d, length(p-vec3(0.0,-A,0.0))-ball, k);
    d=bMin(d, bSeg(p, vec3(0.0,0.0,-A), vec3(0.0,0.0,A), rod), k);
    d=bMin(d, length(p-vec3(0.0,0.0,A))-ball, k); d=bMin(d, length(p-vec3(0.0,0.0,-A))-ball, k);
    return d;
  }`

interface ShapeDef { helpers?: string; expr: string }
// family → { helper fns it needs, body of `float sdfActive(vec3 p)` }. Only the active shape's def is injected.
const SHAPE_DEFS: Record<string, ShapeDef> = {
  sphere: { expr: 'return length(p)-1.0;' },
  cube: { expr: 'vec3 q=abs(p)-vec3(0.82); return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-0.09;' },
  octahedron: { expr: 'p=abs(p); return (p.x+p.y+p.z-1.35)*0.5773;' },
  tetrahedron: { expr: 'float d=max(max(-p.x-p.y-p.z,-p.x+p.y+p.z),max(p.x-p.y+p.z,p.x+p.y-p.z)); return (d-0.7)*0.57735;' },
  dodecahedron: { helpers: H_PLATONIC, expr: 'return sdDodeca(p,0.95);' },
  icosahedron: { helpers: H_PLATONIC, expr: 'return sdIcosa(p,0.92);' },
  cylinder: { helpers: H_CYLCONE, expr: 'return sdCyl(p,0.8,0.7);' },
  cone: { helpers: H_CYLCONE, expr: 'return sdCone(p,0.8,0.9,0.0);' },
  disk: { helpers: H_CYLCONE, expr: 'return sdCyl(p,0.09,1.1);' },
  torus: { expr: 'vec2 q=vec2(length(p.xz)-0.72,p.y); return length(q)-0.30;' },
  genus2: { helpers: H_GENUS, expr: 'float rr=0.46,t=0.15,k=0.06; return kgMin(kgTorZ(p,-0.46,rr,t),kgTorZ(p,0.46,rr,t),k);' },
  triple_torus: { helpers: H_GENUS, expr: 'float rr=0.36,t=0.13,k=0.06; float d=kgMin(kgTorZ(p,-0.62,rr,t),kgTorZ(p,0.0,rr,t),k); return kgMin(d,kgTorZ(p,0.62,rr,t),k);' },
  borromean: { helpers: H_GENUS, expr: 'float rr=0.72,t=0.13,k=0.05; float a=length(vec2(length(p.xy)-rr,p.z))-t; float b=length(vec2(length(p.yz)-rr,p.x))-t; float c=length(vec2(length(p.xz)-rr,p.y))-t; return kgMin(kgMin(a,b,k),c,k);' },
  twisted_torus: { helpers: H_TWISTTORUS, expr: 'return sdfTwistTorus(p);' },
  cut_hollow_sphere: { helpers: H_CUTHOLLOW, expr: 'return sdfCutHollow(p, 0.95, -0.35, 0.06);' },
  blobby: { helpers: H_BLOBBY, expr: 'return sdfBlobby(p);' },
  ellipsoid: { expr: 'vec3 r=vec3(1.18,0.72,0.96); float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/k1;' },
  mazur: { helpers: H_MAZUR, expr: 'float d=length(p)-0.92; d+=(mzNoise(p*2.5)-0.5)*0.26; d+=(mzNoise(p*5.0)-0.5)*0.12; return d*0.55;' },
  // Classical surfaces of revolution / ruled — thin shells (opOnion) to match their parametric-surface meshes.
  hyperboloid: { expr: 'float d=abs(length(p.xz)-sqrt(0.26+p.y*p.y*0.85))-0.05; d=max(d,abs(p.y)-0.95); return d*0.7;' },
  catenoid: { expr: 'float a=0.42; float r=a*0.5*(exp(p.y/a)+exp(-p.y/a)); float d=abs(length(p.xz)-r)-0.05; d=max(d,abs(p.y)-0.7); return d*0.55;' },
  helicoid: { expr: 'float k=2.2; float c=cos(k*p.y),s=sin(k*p.y); vec2 q=mat2(c,-s,s,c)*p.xz; float d=abs(q.y)*0.45; d=max(d,length(p.xz)-0.95); d=max(d,abs(p.y)-0.85); return d;' },
  gyroid: { expr: tpms('dot(s, c.zxy)') },
  schwarz_p: { expr: tpms('c.x+c.y+c.z') },
  schwarz_d: { expr: tpms('s.x*s.y*s.z + s.x*c.y*c.z + c.x*s.y*c.z + c.x*c.y*s.z') },
  trefoil: { helpers: H_KNOT, expr: 'return sdfTorusKnot(p, 2.0, 3.0);' },
  figure8_knot: { helpers: H_KNOT, expr: 'return sdfTorusKnot(p, 3.0, 2.0);' },
  torus_knot_2_5: { helpers: H_KNOT, expr: 'return sdfTorusKnot(p, 2.0, 5.0);' },
  torus_knot_2_7: { helpers: H_KNOT, expr: 'return sdfTorusKnot(p, 2.0, 7.0);' },
  klein_quartic: { helpers: H_KLEIN, expr: 'return sdfKleinQuartic(p*1.2)/1.2;' },
  menger: { helpers: H_MENGER, expr: 'return sdfMenger(p*1.15, 4) * 0.87;' },
  sierpinski: { helpers: H_SIERP, expr: 'return sdfSierpinski(p*1.2, 7) * 0.83;' },
  stanford_bunny: { helpers: H_BUNNY, expr: 'return sdfBunny(p);' },
  mandelbulb: { helpers: H_MANDEL, expr: 'return sdfMandelbulb(p*1.2)/1.2;' },
  mandelbox: { helpers: H_MBOX, expr: 'return sdfMandelbox(p*3.4)/3.4;' },
  julia: { helpers: H_JULIA, expr: 'return sdfJulia(p*1.4)/1.4;' },
  apollonian: { helpers: H_APOLLO, expr: 'return max(sdfApollonian(p)*0.9 - 0.06, length(p)-1.02);' },
  kleinian: { helpers: H_KLEINIAN, expr: 'return max(sdfKleinian(p) - 0.06, length(p)-1.05);' },
  helix: { helpers: H_HELIX, expr: 'return max(sdfHelix(p)*0.7, length(p)-1.0);' },
  mobius: { helpers: H_MOBIUS, expr: 'return sdfMobius(p);' },
  klein_bottle: { helpers: H_KLEINB, expr: 'return sdfKleinBottle(p*2.7)/2.7;' },
  spike: { helpers: H_SPIKE, expr: 'return sdfSpike(p);' },
}

/** Families with an SDF (this is the source of truth RaymarchGem.RAYMARCH_SHAPES is derived from). */
export const SDF_FAMILIES = Object.keys(SHAPE_DEFS)

/** GLSL for ONE shape: its helper fns (if any) + `float sdfActive(vec3 p)`. Injected per-shader so each program
 *  stays small. Unknown family → sphere. Both the hero raymarch + the SDF path tracer inject this. */
export function sdfActiveGLSL(family: string): string {
  const def = SHAPE_DEFS[family] ?? SHAPE_DEFS.sphere
  return `${def.helpers ?? ''}
  float sdfActive(vec3 p){ ${def.expr} }`
}

