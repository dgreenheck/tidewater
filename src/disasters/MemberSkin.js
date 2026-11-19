import {Matrix4,Quaternion} from '../engine/index.js';
import {markGeometryMotion} from '../engine/render/GeometryMotion.js';
const leftMatrix=new Matrix4(),rightMatrix=new Matrix4(),localLeft=new Matrix4(),localRight=new Matrix4(),rotation=new Quaternion(),inverseRest=new Quaternion();
function sectionTransform(out,body){
 rotation.copy(body.quaternion).multiply(inverseRest.copy(body.restQuaternion).invert());out.makeRotationFromQuaternion(rotation);const e=out.elements,p=body.origin;
 e[12]=body.position.x-e[0]*p.x-e[4]*p.y-e[8]*p.z;e[13]=body.position.y-e[1]*p.x-e[5]*p.y-e[9]*p.z;e[14]=body.position.z-e[2]*p.x-e[6]*p.y-e[10]*p.z;return out;
}
function weights(member,span){
 if(span.skinWeights)return span.skinWeights;
 const p=span.pos,c=member.center,a=member.axes[0],L=member.length;
 // An indexed attachment can have any vertex count. Its whole primitive uses
 // one section frame, including vertices that do not form a packed triple.
 if(span.rigidAttachment){let along=0;for(let i=0;i<p.length;i+=3)along+=(p[i]-c.x)*a.x+(p[i+1]-c.y)*a.y+(p[i+2]-c.z)*a.z;return span.skinWeights={owner:along>0?1:0};}
 const blend=new Float64Array(span.count),side=new Uint8Array(span.count/3);
 for(let i=0;i<p.length;i+=3)blend[i/3]=Math.max(0,Math.min(1,((p[i]-c.x)*a.x+(p[i+1]-c.y)*a.y+(p[i+2]-c.z)*a.z)/L+.5));
 for(let i=0;i<p.length;i+=9){let sum=0;for(let j=0;j<9;j+=3)sum+=(p[i+j]-c.x)*a.x+(p[i+j+1]-c.y)*a.y+(p[i+j+2]-c.z)*a.z;side[i/9]=sum>0?1:0;}
 return span.skinWeights={blend,side};
}
// A continuous skin driven by two real rigid section frames. It is a reduced
// flexible member, not a volumetric soft body. After its material joint breaks,
// each tessellated triangle belongs to one real section and can separate.
// Rest weights and affine section transforms avoid allocating vector objects for
// each vertex; their interpolation is identical to the section-frame definition.
export function drawMember(member){
 const left=member.sections[0],right=member.sections.at(-1),rigid=left===right;
 sectionTransform(leftMatrix,left);if(!rigid)sectionTransform(rightMatrix,right);
 for(const s of member.spans){
  const la=s.inverse?localLeft.multiplyMatrices(s.inverse,leftMatrix).elements:leftMatrix.elements;
  const ra=rigid?la:s.inverse?localRight.multiplyMatrices(s.inverse,rightMatrix).elements:rightMatrix.elements;
  const position=s.geo.attributes.position,normal=s.geo.attributes.normal,base=s.start*3,P=s.pos,N=s.nrm,A=position.array,B=normal?.array,W=rigid?null:weights(member,s);markGeometryMotion(s.geo,s.start,s.count);
  for(let i=0;i<P.length;i+=3){const x=P[i],y=P[i+1],z=P[i+2],t=rigid?0:W.owner??(member.severed?W.side[Math.floor(i/9)]:W.blend[i/3]);
   let px=la[0]*x+la[4]*y+la[8]*z+la[12],py=la[1]*x+la[5]*y+la[9]*z+la[13],pz=la[2]*x+la[6]*y+la[10]*z+la[14];
   if(t){px+=(ra[0]*x+ra[4]*y+ra[8]*z+ra[12]-px)*t;py+=(ra[1]*x+ra[5]*y+ra[9]*z+ra[13]-py)*t;pz+=(ra[2]*x+ra[6]*y+ra[10]*z+ra[14]-pz)*t;}
   A[base+i]=px;A[base+i+1]=py;A[base+i+2]=pz;
   if(B&&N){const x=N[i],y=N[i+1],z=N[i+2];let nx=la[0]*x+la[4]*y+la[8]*z,ny=la[1]*x+la[5]*y+la[9]*z,nz=la[2]*x+la[6]*y+la[10]*z;
    if(t){nx+=(ra[0]*x+ra[4]*y+ra[8]*z-nx)*t;ny+=(ra[1]*x+ra[5]*y+ra[9]*z-ny)*t;nz+=(ra[2]*x+ra[6]*y+ra[10]*z-nz)*t;}const inv=1/(Math.hypot(nx,ny,nz)||1);B[base+i]=nx*inv;B[base+i+1]=ny*inv;B[base+i+2]=nz*inv;
   }
  }
  position.addUpdateRange(base,P.length);position.needsUpdate=true;if(normal){normal.addUpdateRange(base,P.length);normal.needsUpdate=true;}
 }
}
