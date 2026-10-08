import { repairMesh, validateRepairOptions } from './repair.js';
import { repairAdvanced } from './repair-advanced.js';
import { toManifold } from './geometry.js';

export async function repairSolid(module,data,options,loadCore){
  const o=validateRepairOptions(options);
  if(data.indices.length/3>1_000_000)throw new Error('O reparo aceita até 1 milhão de triângulos.');
  try{
    const repaired=repairMesh(data,o),solid=toManifold(module,repaired);
    repaired.repairReport.method='conservative';
    return {repaired,solid};
  }catch(error){
    if(!o.advancedRepair)throw error;
  }
  const core=await loadCore(),repaired=repairAdvanced(data,o,core);
  let solid;
  try{solid=toManifold(module,repaired);}
  catch{throw new Error('O resultado ainda não foi aceito como sólido para cavidades. Nenhum reparo parcial foi aplicado.');}
  return {repaired,solid};
}
