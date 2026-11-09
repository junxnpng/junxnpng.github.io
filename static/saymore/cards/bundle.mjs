export async function parseBundle(text){
  if(typeof text!=='string'||text.length>50*1024*1024)throw Error('50MB 이하의 카드 백업을 사용해 주세요.');
  const bundle=JSON.parse(text);
  if(bundle?.format!=='saymore-card-bundle'||bundle.version!==1||!Array.isArray(bundle.files)||!bundle.files.length||bundle.files.length>5000)throw Error('SayMore 카드 백업 형식이 아닙니다.');
  const paths=new Set(),files=[];
  for(const entry of bundle.files){
    if(typeof entry?.path!=='string'||entry.path.length>200||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f]/.test(entry.path)||paths.has(entry.path))throw Error('백업의 파일 경로가 올바르지 않습니다.');
    if(typeof entry.base64!=='string'||entry.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.base64)||!entry.base64.length||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('백업 파일의 형식이나 내용 확인 값이 없습니다.');
    const bytes=Uint8Array.from(atob(entry.base64),c=>c.charCodeAt(0));
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==entry.sha256)throw Error('백업 파일의 내용이 원본과 다릅니다. 가져오기를 중단했습니다.');
    const mime=['audio/mpeg','image/jpeg','image/png','image/webp','text/plain','text/markdown','application/json'].includes(entry.mime)?entry.mime:'application/octet-stream';
    paths.add(entry.path);files.push({path:entry.path,blob:new Blob([bytes],{type:mime})});
  }
  return files;
}
