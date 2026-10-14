import { tangentBasis } from './geometry.js';

// Right-handed view frames: local U is screen-right, V is up, W faces the viewer.
export const CUT_FRAMES = {
  front: {u:[1,0,0],v:[0,0,1],w:[0,-1,0]},
  side: {u:[0,1,0],v:[0,0,1],w:[1,0,0]},
  top: {u:[1,0,0],v:[0,1,0],w:[0,0,1]},
};
// Starting values for separate printed parts, not printer accuracy guarantees.
export const FIT_PROFILES = {
  resin: {gap:0.1,kind:'round',width:4,length:4,clearance:0.15,bottom:0.3,wall:1},
  filament: {gap:0.2,kind:'key',width:6,length:8,clearance:0.25,bottom:0.4,wall:1.5},
};
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function cutFrame(view){const frame=CUT_FRAMES[view];if(!frame)throw new Error('Escolha uma vista de corte válida.');return frame;}
export function toWorld(frame,p){return [0,1,2].map(k=>frame.u[k]*p[0]+frame.v[k]*p[1]+frame.w[k]*p[2]);}
export function localBounds(box,frame){
  const points=[];for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])points.push([x,y,z]);
  return {min:[frame.u,frame.v,frame.w].map(n=>Math.min(...points.map(p=>dot(p,n)))),max:[frame.u,frame.v,frame.w].map(n=>Math.max(...points.map(p=>dot(p,n))))};
}
export function curvePoints(points){
  if(!Array.isArray(points)||points.length<2||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new Error('Desenhe uma curva com pelo menos dois pontos.');
  const p=points.map(p=>p.slice());if(p[0][0]>p.at(-1)[0])p.reverse();
  if(p.some((v,i)=>i&&v[0]-p[i-1][0]<0.0001))throw new Error('Desenhe da esquerda para a direita, sem voltar sobre a linha.');
  return p;
}
// Monotonic U and smoothstep V avoid overshoot and undercuts along the assembly axis.
export function curveHeight(points,u){
  if(u<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++)if(u<=points[i][0]){const a=points[i-1],b=points[i],t=(u-a[0])/(b[0]-a[0]),s=t*t*(3-2*t);return a[1]+(b[1]-a[1])*s;}
  return points.at(-1)[1];
}
export function sampledCurve(points,min,max){
  const p=curvePoints(points),out=[[min,curveHeight(p,min)]];
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i],steps=Math.max(8,Math.ceil((b[0]-a[0])/0.25));
    for(let j=0;j<=steps;j++){const u=a[0]+(b[0]-a[0])*j/steps;if(u>min&&u<max&&u>out.at(-1)[0])out.push([u,curveHeight(p,u)]);}
  }
  out.push([max,curveHeight(p,max)]);return out;
}
function transform(frame,origin=[0,0,0]){return [...frame.u,0,...frame.v,0,...frame.w,0,...origin,1];}
function validateJoint(j){
  if(!['round','key'].includes(j.kind)||!['u','w','width','length','clearance','bottom','wall'].every(k=>Number.isFinite(j[k])))throw new Error('Preencha as medidas do encaixe com números válidos.');
  if(j.width<1||j.length<1||j.width>100||j.length>100||j.clearance<0||j.clearance>2||j.bottom<0||j.bottom>5||j.wall<0.5||j.wall>10)throw new Error('Use largura e profundidade de 1 a 100 mm, folga lateral de 0 a 2 mm, fundo de 0 a 5 mm e parede mínima de 0,5 a 10 mm.');
}
function jointTool(m,frame,j,low,high,extra=0){
  const width=j.width+2*extra,h=high-low;
  let primitive,placed;
  if(j.kind==='round')primitive=m.Manifold.cylinder(h,width/2,width/2,64,false);
  else{const cube=m.Manifold.cube([width,width,h]);try{primitive=cube.translate([-width/2,-width/2,0]);}finally{cube.delete();}}
  const {u,v}=tangentBasis(frame.v),origin=toWorld(frame,[j.u,low,j.w]);
  try{placed=primitive.transform([...u,0,...v,0,...frame.v,0,...origin,1]);return placed;}finally{primitive.delete();}
}
function volumeOf(s){try{return Math.abs(s.volume());}finally{s.delete();}}
function validSolid(s){return s.status()==='NoError'&&!s.isEmpty()&&s.volume()>1e-8;}
function componentCount(s){const parts=s.decompose();try{return parts.length;}finally{parts.forEach(p=>p.delete());}}

export function organicSplit(m,base,options){
  const frame=cutFrame(options.view),p=curvePoints(options.points),bounds=localBounds(base.boundingBox(),frame);
  const joints=options.joints||[];joints.forEach(validateJoint);
  const gap=options.gap??0;if(!Number.isFinite(gap)||gap<0||gap>2)throw new Error('Use folga entre faces de 0 a 2 mm.');
  if(p[0][0]>bounds.min[0]||p.at(-1)[0]<bounds.max[0])throw new Error('A curva deve atravessar toda a largura da peça. Comece e termine fora das bordas.');
  const margin=Math.max(...bounds.max.map((x,i)=>x-bounds.min[i]))+1;
  const left=bounds.min[0]-margin,right=bounds.max[0]+margin,bottom=bounds.min[1]-margin;
  const path=sampledCurve(p,left,right),polygon=[[left,bottom],[right,bottom],...path.slice().reverse()];
  let section,tool,extruded,lowTool,highTool,a,b;const sockets=[];
  try{
    section=new m.CrossSection([polygon]);extruded=section.extrude(bounds.max[2]-bounds.min[2]+2*margin);
    tool=extruded.transform(transform(frame,toWorld(frame,[0,0,bounds.min[2]-margin])));
    if(gap){lowTool=tool.translate(frame.v.map(x=>-x*gap/2));highTool=tool.translate(frame.v.map(x=>x*gap/2));a=base.intersect(lowTool);b=base.subtract(highTool);}
    else [a,b]=base.split(tool);
    if(!validSolid(a)||!validSolid(b))throw new Error('A curva precisa dividir o volume em duas partes. Desenhe sobre a peça.');
    const tolerance=Math.max(1e-6,base.volume()*1e-8);
    for(let i=0;i<joints.length;i++){
      const j=joints[i],radius=j.width/2+j.clearance+j.wall;
      const heights=sampledCurve(p,j.u-radius,j.u+radius).map(p=>p[1]);
      const low=Math.min(...heights)-gap/2-j.wall,high=Math.max(...heights)+gap/2+j.length;
      let pin,socket,guard,nextA,nextB;
      try{
        pin=jointTool(m,frame,j,low,high);
        socket=jointTool(m,frame,j,low,high+j.bottom,j.clearance);
        guard=jointTool(m,frame,j,low-j.wall,high+j.bottom+j.wall,j.clearance+j.wall);
        if(volumeOf(guard.subtract(base))>tolerance)throw new Error(`Encaixe ${i+1}: falta material ao redor ou no fundo. Mova o encaixe ou reduza suas medidas.`);
        if(sockets.some(previous=>volumeOf(socket.intersect(previous))>tolerance))throw new Error('Os encaixes se sobrepõem. Afaste suas posições.');
        if(volumeOf(pin.intersect(a))<=tolerance||volumeOf(pin.intersect(b))<=tolerance)throw new Error(`Encaixe ${i+1}: posicione na região que une as duas partes.`);
        nextA=a.add(pin);nextB=b.subtract(socket);
        if(!validSolid(nextA)||!validSolid(nextB))throw new Error('O encaixe não gerou duas peças válidas.');
        a.delete();b.delete();a=nextA;b=nextB;nextA=null;nextB=null;
        sockets.push(socket);socket=null;
      }finally{pin?.delete();socket?.delete();guard?.delete();nextA?.delete();nextB?.delete();}
    }
    if(volumeOf(a.intersect(b))>tolerance)throw new Error('As partes ficaram sobrepostas. Revise a curva e os encaixes.');
    const report={volumes:[a.volume(),b.volume()],components:[componentCount(a),componentCount(b)],joints:joints.length,gap,assemblyAxis:frame.v};
    const parts=[a,b];a=null;b=null;return {parts,report};
  }finally{a?.delete();b?.delete();section?.delete();extruded?.delete();tool?.delete();lowTool?.delete();highTool?.delete();sockets.forEach(s=>s.delete());}
}
