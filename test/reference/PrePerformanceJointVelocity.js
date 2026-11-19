// Frozen pre-optimization contact wrapper, retained only as an equivalence oracle.
import { ArticulatedMass } from '../../src/player/ArticulatedMass.js';
// Passive, fixed-pose velocity constraints for the articulated capsules.
// Position corrections retain their separate job of repairing geometric error.
// Common-anchor impulses conserve total linear/angular momentum. Passivity
// belongs to the complete implicit viscosity/contact solve with its accumulated
// impulses, not to each response increment in isolation.
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const add=(a,b,s=1)=>({x:a.x+s*b.x,y:a.y+s*b.y,z:a.z+s*b.z});
const scale=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const length=a=>Math.hypot(a.x,a.y,a.z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rotate(q,v){const t=scale(cross(q,v),2);return add(add(v,t,q.w),cross(q,t));}
function velocityAt(b,r){return add(b.v,cross(b.w,r));}
function atanGradient(y,x,gy,gx){const d=x*x+y*y;return d>1e-14?scale(add(scale(gy,x),gx,-y),1/d):{x:0,y:0,z:0};}
export function jointCoordinates(p,c){
 const a2=rotate(c.q,c.ax),out=[];
 if(c.hinge){
  const h1=rotate(p.q,c.hP),h2=rotate(c.q,c.hC),d=clamp(dot(a2,h1),-1,1),e=Math.asin(d);
  out.push({kind:'plane',angle:e,min:-c.cone,max:c.cone,n:scale(cross(a2,h1),1/Math.sqrt(Math.max(1e-12,1-d*d)))});
  const d1=dot(h1,a2),d2=dot(h2,a2),y=dot(cross(h1,h2),a2),x=dot(h1,h2)-d1*d2;
  const gy=add(cross(h2,cross(a2,h1)),cross(a2,cross(h1,h2))),gx=add(cross(h2,h1),cross(a2,h1),-d2);
  out.push({kind:'twist',angle:Math.atan2(y,x),min:-c.twist,max:c.twist,n:atanGradient(y,x,gy,gx)});
  const a1=rotate(p.q,p.ax),fy=dot(cross(a1,a2),h1),fx=dot(a1,a2);
  out.push({kind:'flex',angle:Math.atan2(fy,fx),min:c.hinge[0],max:c.hinge[1],n:atanGradient(fy,fx,cross(a2,cross(h1,a1)),cross(a2,a1))});
 }else{
  const a1=rotate(p.q,c.aN),crossAxis=cross(a1,a2),s=length(crossAxis),th=Math.atan2(s,dot(a1,a2));
  out.push({kind:'cone',angle:th,min:-Infinity,max:c.cone,n:s>1e-8?scale(crossAxis,1/s):{x:0,y:0,z:0}});
  const sum=add(a1,a2),len=length(sum);if(len<1e-3)return out;const n=scale(sum,1/len),b1=rotate(p.q,c.bN),b2=rotate(c.q,c.bC),d1=dot(b1,n),d2=dot(b2,n);
  const dn=t=>scale(cross(a2,add(t,n,-dot(n,t))),1/len),y=dot(cross(b1,b2),n),x=dot(b1,b2)-d1*d2;
  const gy=add(cross(b2,cross(n,b1)),dn(cross(b1,b2))),gx=add(add(cross(b2,b1),dn(b1),-d2),add(cross(b2,n),dn(b2)),-d1);
  out.push({kind:'twist',angle:Math.atan2(y,x),min:-c.twist,max:c.twist,n:atanGradient(y,x,gy,gx)});
 }
 return out;
}
// Constrained point response for frame-boundary contacts. The 39 ball-anchor
// rows share one factorization at this fixed pose. A unit point impulse is
// projected through all joints before its effective inverse mass is measured;
// the contact therefore cannot treat a connected forearm as an isolated mass.
export function articulatedContact(rig,{viscosityStep=0}={}){
 const bodies=rig.bodies,N=bodies.length*6,factor=rig._articulatedMass?rig._articulatedMass.update(viscosityStep):(rig._articulatedMass=new ArticulatedMass(rig,viscosityStep)),velocity=factor.solve(factor.momentum());
 bodies.forEach((b,i)=>{const k=i*6;b.v.x=velocity[k];b.v.y=velocity[k+1];b.v.z=velocity[k+2];b.w.x=velocity[k+3];b.w.y=velocity[k+4];b.w.z=velocity[k+5];});
 function response(b,r,j){const f=new Float64Array(N),k=b.index*6,t=cross(r,j);f.set([j.x,j.y,j.z,t.x,t.y,t.z],k);return factor.solve(f);}
 const pointCache=new WeakMap(),angleCache=new Map(),units=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
 function pointResponse(b,r){let result=pointCache.get(r);if(!result){result=units.map(n=>response(b,r,n));pointCache.set(r,result);}return result;}
 function apply(list,x,y,z){bodies.forEach((b,i)=>{const k=i*6;b.v.x+=list[0][k]*x+list[1][k]*y+list[2][k]*z;b.v.y+=list[0][k+1]*x+list[1][k+1]*y+list[2][k+1]*z;b.v.z+=list[0][k+2]*x+list[1][k+2]*y+list[2][k+2]*z;b.w.x+=list[0][k+3]*x+list[1][k+3]*y+list[2][k+3]*z;b.w.y+=list[0][k+4]*x+list[1][k+4]*y+list[2][k+4]*z;b.w.z+=list[0][k+5]*x+list[1][k+5]*y+list[2][k+5]*z;});}
 function angularResponse(p,c){let result=angleCache.get(c);if(!result){result=units.map((n,j)=>{const f=new Float64Array(N);f[p.index*6+3+j]=1;f[c.index*6+3+j]=-1;return factor.solve(f);});angleCache.set(c,result);}return result;}
 let limitRows=null;
 function contactVelocity(list,k,r){return add({x:list[k],y:list[k+1],z:list[k+2]},cross({x:list[k+3],y:list[k+4],z:list[k+5]},r));}
 function weighted(list,n){const result=new Float64Array(N);for(let k=0;k<N;k++)result[k]=list[0][k]*n.x+list[1][k]*n.y+list[2][k]*n.z;return result;}
 return {
  report(){let anchorResidual=0;for(const c of rig.joints){const p=c.parent,at=scale(add(add(p.x,rotate(p.q,c.rP)),add(c.x,rotate(c.q,c.o))),.5),u=add(velocityAt(c,add(at,c.x,-1)),velocityAt(p,add(at,p.x,-1)),-1);anchorResidual=Math.max(anchorResidual,Math.abs(u.x),Math.abs(u.y),Math.abs(u.z));}return {anchorResidual,limits:(limitRows||[]).map(row=>({body:row.c.name,n:row.n,allow:row.allow,impulse:row.impulse,speed:dot(add(row.c.w,row.p.w,-1),row.n)}))};},
  wPos(b,r,n){const list=pointResponse(b,r),k=b.index*6,v=[];for(let j=0;j<6;j++)v[j]=list[0][k+j]*n.x+list[1][k+j]*n.y+list[2][k+j]*n.z;return dot(add({x:v[0],y:v[1],z:v[2]},cross({x:v[3],y:v[4],z:v[5]},r)),n);},
  impulse(b,r,x,y,z){apply(pointResponse(b,r),x,y,z);},
  pairMass(a,ra,b,rb,n){const A=weighted(pointResponse(a,ra),n),B=weighted(pointResponse(b,rb),n);for(let i=0;i<N;i++)B[i]-=A[i];return dot(add(contactVelocity(B,b.index*6,rb),contactVelocity(B,a.index*6,ra),-1),n);},
  pairImpulse(a,ra,b,rb,x,y,z){apply(pointResponse(a,ra),-x,-y,-z);apply(pointResponse(b,rb),x,y,z);},
  limits(h){
   let maximumChange=0;
   if(!limitRows){limitRows=[];for(const c of rig.joints)for(const coordinate of jointCoordinates(c.parent,c)){
    const p=c.parent,{n,angle,min,max}=coordinate;
    const len=length(n);if(len<1e-8)continue;
    if(Number.isFinite(max))limitRows.push({p,c,n,allow:Math.max(0,(max-angle)/h),impulse:0});
    if(Number.isFinite(min))limitRows.push({p,c,n:scale(n,-1),allow:Math.max(0,(angle-min)/h),impulse:0});
   }}
   for(const row of limitRows){const {p,c,n,allow}=row,speed=dot(add(c.w,p.w,-1),n);if(!row.impulse&&speed<=allow)continue;
    if(!row.list){row.list=angularResponse(p,c);const v=weighted(row.list,n),kp=p.index*6+3,kc=c.index*6+3;row.eff=(v[kp]-v[kc])*n.x+(v[kp+1]-v[kc+1])*n.y+(v[kp+2]-v[kc+2])*n.z;}
    const total=Math.max(0,row.impulse+(speed-allow)/row.eff),J=total-row.impulse;row.impulse=total;maximumChange=Math.max(maximumChange,Math.abs(J));apply(row.list,n.x*J,n.y*J,n.z*J);
   }
   return maximumChange;
  },
 };

}


// Frozen geometric repair: recompute all coordinates after every attempted row.
function rot( q, v, o, s = 1 ) {

	const x = v.x, y = v.y, z = v.z, qx = q.x * s, qy = q.y * s, qz = q.z * s, qw = q.w;
	const tx = 2 * ( qy * z - qz * y ), ty = 2 * ( qz * x - qx * z ), tz = 2 * ( qx * y - qy * x );
	o.x = x + qw * tx + qy * tz - qz * ty;
	o.y = y + qw * ty + qz * tx - qx * tz;
	o.z = z + qw * tz + qx * ty - qy * tx;
	return o;

}


export function repairJoint( c, anchors = true ) {

		const _rp = {}, _rc = {}, _n = {}, _P = {}, _aP = {};
		const p = c.parent;
		// ball joint: the child's bone head onto its anchor on the parent
		const rp = rot( p.q, c.rP, _rp ), rc = rot( c.q, c.o, _rc );
		const dx = c.x.x + rc.x - p.x.x - rp.x, dy = c.x.y + rc.y - p.x.y - rp.y, dz = c.x.z + rc.z - p.x.z - rp.z, d = Math.hypot( dx, dy, dz );
		if ( anchors && d > 1e-7 ) {

			const n = _n; n.x = dx / d; n.y = dy / d; n.z = dz / d;
			const l = d / ( this.wPos( p, rp, n ) + this.wPos( c, rc, n ) ), P = _P;
			P.x = n.x * l; P.y = n.y * l; P.z = n.z * l;
			this.applyPos( p, rp, P, 1 );
			this.applyPos( c, rc, P, - 1 );

		}

		// Position repair uses the actual coordinate gradient, including its
		// magnitude. The mean anatomical axis is not the derivative at a tilt.
		const count = c.hinge ? 3 : 2;
		for ( let i = 0; i < count; i ++ ) {
			const coordinate = jointCoordinates( p, c )[ i ]; if ( ! coordinate ) continue;
			const { angle, min, max, n } = coordinate, target = Math.min( max, Math.max( min, angle ) ), error = angle - target;
			if ( Math.abs( error ) < 1e-7 ) continue;
			const inverseMass = this.wRot( p, n ) + this.wRot( c, n ); if ( inverseMass < 1e-12 ) continue;
			const impulse = error / inverseMass, P = _aP; P.x = n.x * impulse; P.y = n.y * impulse; P.z = n.z * impulse;
			this.applyRot( p, P, 1 ); this.applyRot( c, P, - 1 );
		}

	}
