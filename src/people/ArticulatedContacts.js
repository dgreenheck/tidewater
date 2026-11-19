// Narrow phase for actual capsule segments. Contacts use rotational effective
// mass and equal/opposite impulses; projection corrects overlap without turning
// correction distance into a launch velocity. Adjacent joint capsules overlap
// by construction, so self-collision excludes bodies within two joints.
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
const clamp=x=>Math.max(0,Math.min(1,x));
function axis(b){
 const q=b.q,v=b.ax,tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);
 return{x:v.x+q.w*tx+q.y*tz-q.z*ty,y:v.y+q.w*ty+q.z*tx-q.x*tz,z:v.z+q.w*tz+q.x*ty-q.y*tx};
}
function atVelocity(b,r){return{x:b.v.x+b.w.y*r.z-b.w.z*r.y,y:b.v.y+b.w.z*r.x-b.w.x*r.z,z:b.v.z+b.w.x*r.y-b.w.y*r.x};}
export function capsuleContact(a,b){
 const reach=a.len*.5+b.len*.5+a.r+b.r,delta=sub(b.x,a.x);if(dot(delta,delta)>reach*reach)return null;
 const aa=axis(a),ba=axis(b),p=add(a.x,aa,-a.len*.5),q=add(b.x,ba,-b.len*.5),d=add({x:0,y:0,z:0},aa,a.len),e=add({x:0,y:0,z:0},ba,b.len),r=sub(p,q);
 const A=dot(d,d),E=dot(e,e),F=dot(e,r);let s=0,t=0;
 if(A<=1e-12)t=E>1e-12?clamp(F/E):0;
 else{const C=dot(d,r);if(E<=1e-12)s=clamp(-C/A);else{const B=dot(d,e),den=A*E-B*B;s=den>1e-12?clamp((B*F-C*E)/den):0;t=(B*s+F)/E;if(t<0){t=0;s=clamp(-C/A);}else if(t>1){t=1;s=clamp((B-C)/A);}}}
 const x=add(p,d,s),y=add(q,e,t),n=sub(y,x),distance=Math.hypot(n.x,n.y,n.z),penetration=a.r+b.r-distance;
 if(penetration<=0)return null;
 if(distance>1e-8){n.x/=distance;n.y/=distance;n.z/=distance;}else{const l=Math.hypot(delta.x,delta.y,delta.z);if(l>1e-8){n.x=delta.x/l;n.y=delta.y/l;n.z=delta.z/l;}else{n.x=1;n.y=n.z=0;}}
 const point=add(x,n,a.r-penetration*.5);
 return{normal:n,point,penetration};
}
export function solveCapsules(A,a,B,b,{project=true,restitution=.1}={}){
 const c=capsuleContact(a,b);if(!c)return null;
 const n=c.normal,ra=sub(c.point,a.x),rb=sub(c.point,b.x),wa=A.wPos(a,ra,n),wb=B.wPos(b,rb,n),w=wa+wb;
 const va=atVelocity(a,ra),vb=atVelocity(b,rb),closing=dot(sub(va,vb),n);let impulse=0;
 if(closing>0){impulse=(1+restitution)*closing/w;A.impulse(a,ra,-n.x*impulse,-n.y*impulse,-n.z*impulse);B.impulse(b,rb,n.x*impulse,n.y*impulse,n.z*impulse);}
 // Translation-only stabilization preserves both inertia orientations and all
 // reported velocities. Rotating a spinning capsule during a zero-speed
 // overlap correction would change its kinetic energy without an impulse.
 if(project){const correction=Math.min(.035,Math.max(0,c.penetration-.002)*.4)/(a.im+b.im);
  a.x.x-=n.x*correction*a.im;a.x.y-=n.y*correction*a.im;a.x.z-=n.z*correction*a.im;
  b.x.x+=n.x*correction*b.im;b.x.y+=n.y*correction*b.im;b.x.z+=n.z*correction*b.im;
 }
 return{...c,impulse};
}
export function adjacent(a,b){return a.parent===b||b.parent===a||a.parent?.parent===b||b.parent?.parent===a||!!a.parent&&a.parent===b.parent;}

// The upright controller supplies a 75kg capsule. Initial walking impacts and
// later overlaps use the same actual segment geometry, rather than inventing a
// chest-height point and attaching it to whichever limb COM happens to be near.
export function collideWalker(rig,player,{velocity=player.velocity,restitution=.1}={}){
 const h=player.mode==='swim'?1:1.75,foot=player.position.y-(player.mode==='swim'?1.458:0);
 const b={x:{x:player.position.x,y:foot+h/2,z:player.position.z},v:velocity,w:{x:0,y:0,z:0},ax:{x:0,y:1,z:0},q:{x:0,y:0,z:0,w:1},len:h-.6,r:.3,im:1/75};
 const proxy={wPos:()=>b.im,impulse:(body,r,x,y,z)=>{body.v.x+=x*b.im;body.v.y+=y*b.im;body.v.z+=z*b.im;}};
 const contacts=[];let remaining=.15;
 for(const a of rig.bodies){
  const contact=solveCapsules(rig,a,proxy,b,{project:false,restitution});if(!contact)continue;
  // Position repair belongs to the single upright capsule. Moving one limb
  // after the articulated solve strains its anchors and creates a next-step
  // correction velocity, even though the immediate reported energy is unchanged.
  const correction=Math.min(remaining,Math.max(0,contact.penetration-.002));
  b.x.x+=contact.normal.x*correction;b.x.y+=contact.normal.y*correction;b.x.z+=contact.normal.z*correction;remaining-=correction;
  contacts.push({...contact,body:a.index});
 }
 player.position.x=b.x.x;player.position.y+=b.x.y-(foot+h/2);player.position.z=b.x.z;
 return contacts;
}
