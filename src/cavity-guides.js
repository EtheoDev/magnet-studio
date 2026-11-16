import { Group, Line, BufferGeometry, BufferAttribute, DynamicDrawUsage, LineBasicMaterial, Vector3 } from 'three';
import { surfaceGuides } from './surface-guides.js';

export function createCavityGuides(scene,camera,host) {
  const group=new Group();group.visible=false;scene.add(group);
  const overlay=document.createElement('div');overlay.className='cavity-guide-overlay';overlay.hidden=true;host.append(overlay);
  const legend=document.createElement('div');legend.className='cavity-guide-legend';legend.textContent='Folgas aproximadas na superfície · verde = centralizado';overlay.append(legend);
  const names=['Esquerda','Direita','Acima','Abaixo'];
  const items=names.map(name=>{
    const line=new Line(new BufferGeometry(),new LineBasicMaterial({transparent:true,opacity:.95,depthTest:false,depthWrite:false}));line.renderOrder=5;line.frustumCulled=false;group.add(line);
    line.geometry.setAttribute('position',new BufferAttribute(new Float32Array(164*3),3).setUsage(DynamicDrawUsage));
    const label=document.createElement('span');label.className='cavity-guide-label';overlay.append(label);
    return {line,label,name,anchor:new Vector3()};
  });
  const projected=new Vector3(),right=new Vector3(),up=new Vector3();
  return {
    show(mesh,cavity,radius){
      if(!mesh?.geometry.boundsTree)return this.clear();
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld,0);up.setFromMatrixColumn(camera.matrixWorld,1);
      const box=mesh.geometry.boundingBox,diagonal=box.getSize(new Vector3()).length();
      const guides=surfaceGuides(mesh.geometry.boundsTree,{...cavity,right:right.toArray(),up:up.toArray(),radius,maxDistance:diagonal});
      const normal=new Vector3(...guides.normal),lift=Math.max(.015,diagonal*.0001);
      guides.arms.forEach((arm,i)=>{
        const item=items[i],centered=i<2?guides.horizontalCentered:guides.verticalCentered;
        const color=!arm.fits?'#ffa9a9':centered?'#8bffba':i<2?'#ffd68a':'#8ee5ff';
        const points=arm.points.map(p=>new Vector3(...p).addScaledVector(normal,lift));
        const position=item.line.geometry.getAttribute('position');
        points.forEach((p,index)=>position.setXYZ(index,p.x,p.y,p.z));position.needsUpdate=true;
        item.line.geometry.setDrawRange(0,points.length);item.line.material.color.set(color);
        item.anchor.copy(points[Math.floor(points.length/2)]||new Vector3(...cavity.point));
        item.label.textContent=`${arm.boundary?'':'≥ '}${arm.clearance.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})} mm`;
        item.label.title=`${item.name}: folga aproximada da borda do encaixe até o limite da superfície local`;
        item.label.style.color=color;item.label.classList.toggle('centered',centered);
      });
      group.visible=true;overlay.hidden=false;this.updateLabels();
    },
    updateLabels(){
      if(!group.visible)return;
      const width=host.clientWidth,height=host.clientHeight;
      items.forEach(({anchor,label},i)=>{
        projected.copy(anchor).project(camera);
        label.hidden=projected.z< -1||projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1;
        label.style.left=`${(projected.x*.5+.5)*width+(i<2?0:12)}px`;
        label.style.top=`${(-projected.y*.5+.5)*height+(i<2?-12:0)}px`;
      });
    },
    clear(){group.visible=false;overlay.hidden=true;},
    dispose(){group.removeFromParent();items.forEach(({line})=>{line.geometry.dispose();line.material.dispose();});overlay.remove();}
  };
}
