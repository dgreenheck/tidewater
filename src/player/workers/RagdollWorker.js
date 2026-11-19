import {runRigJob} from './RigSnapshot.js';
self.onmessage=({data})=>{
 const results=data.jobs.map(job=>{try{return runRigJob(job,data.field);}catch(error){return {id:job.id,error:String(error)};}});
 self.postMessage({id:data.id,results});
};
