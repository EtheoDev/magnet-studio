import {Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {toGeometry} from './geometry.js';

const CONTACT_TOLERANCE=0.02;
const vector=p=>new Vector3(p?.x,p?.y,p?.z);
const finite=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);

// LYS stores contact points in mesh-local coordinates. For normal-aligned cones,
// tip + normal * length is the existing socket: preserve it when extending a tip.
export function reconnectLysSupports(scene,objectId,originalData,editedData) {
  const next=structuredClone(scene),adjustments=[],unresolved=[];
  const originalGeometry=toGeometry(originalData),editedGeometry=toGeometry(editedData);
  try{
    const oldTree=new MeshBVH(originalGeometry),newTree=new MeshBVH(editedGeometry);
    const far=editedGeometry.boundingBox.getSize(new Vector3()).length()*2;
    for(const [id,support] of Object.entries(next.supports?.present?.byId||{})){
      for(const endpoint of ['tip','base']){
        const ownership=endpoint==='tip'?'objectIdTip':'objectIdBase';
        const parent=endpoint==='tip'?'parentTipId':'parentBaseId';
        if(support[ownership]!==objectId||support[parent]||!finite(support[endpoint]))continue;
        // A base is a mesh contact only when explicitly authored as a base tip.
        if(endpoint==='base'&&!support.isBaseTip)continue;
        const point=vector(support[endpoint]);
        if(oldTree.closestPointToPoint(point).distance>CONTACT_TOLERANCE)continue;
        if(newTree.closestPointToPoint(point).distance<=CONTACT_TOLERANCE)continue;
        const settingsKey=endpoint==='tip'?'tip':'baseTip';
        const settings=support.settings?.[settingsKey],normalValue=support[endpoint+'Normal'];
        const reject=reason=>unresolved.push({id,endpoint,reason});
        if(!finite(normalValue)||!settings||settings.type!=='cone'||settings.angle!==100||settings.isStraight||!Number.isFinite(settings.length)||settings.length<=0){
          reject('Este tipo de ponta exige reposicionamento no Lychee.');continue;
        }
        const normal=vector(normalValue);
        if(Math.abs(normal.length()-1)>.001){reject('Normal da ponta inválida.');continue;}normal.normalize();
        const direction=normal.clone().negate(),origin=point.clone().addScaledVector(normal,CONTACT_TOLERANCE);
        const hits=newTree.raycast(new Ray(origin,direction),DoubleSide,0,far).sort((a,b)=>a.distance-b.distance);
        const hit=hits[0];
        // Only extend to an aligned, newly created surface. A ray through a
        // drainage opening must never attach to an unchanged wall behind it.
        if(!hit||hit.face.normal.dot(normal)<.98||oldTree.closestPointToPoint(hit.point).distance<=CONTACT_TOLERANCE){
          reject('Não há fundo de encaixe livre nessa direção; a ponta pode estar sobre uma drenagem.');continue;
        }
        const extension=hit.distance-CONTACT_TOLERANCE;
        if(extension<=CONTACT_TOLERANCE||extension>100){reject('Distância de reconexão fora do limite.');continue;}
        const length=settings.length+extension,newPoint=point.clone().addScaledVector(direction,extension);
        support[endpoint]={...support[endpoint],x:newPoint.x,y:newPoint.y,z:newPoint.z};
        settings.length=length;
        if(endpoint==='tip'&&support.newTipNormal!=null)support.newTipNormal=null;
        adjustments.push({id,endpoint,extension,oldLength:length-extension,newLength:length});
      }
    }
    return {scene:next,report:{adjusted:adjustments.length,unresolved:unresolved.length,adjustments,issues:unresolved}};
  }finally{originalGeometry.dispose();editedGeometry.dispose();}
}
