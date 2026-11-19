// CPU model tests omit only stylesheet loading, which has no simulation logic.
export async function load(url,context,next){
 if(url.endsWith('.css'))return{format:'module',source:'export {};',shortCircuit:true};
 return next(url,context);
}
