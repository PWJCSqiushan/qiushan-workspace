import {jwtVerify,type JWTVerifyGetKey} from 'jose';
import {AppError} from './workspace.ts';
export async function verifyAccess(token:string,keys:JWTVerifyGetKey,issuer:string,audience:string,email:string){
 try{const {payload}=await jwtVerify(token,keys,{issuer,audience,algorithms:['RS256'],requiredClaims:['sub','exp','email']});if(payload.email!==email||typeof payload.sub!=='string'||!payload.sub)throw new AppError('该身份没有访问权限',403);return payload;}
 catch(e){if(e instanceof AppError)throw e;throw new AppError('登录已过期，请重新登录',401);}
}
