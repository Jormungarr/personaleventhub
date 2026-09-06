const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname;
const DATA_FILE=path.join(root,'events.json');
const BOARDS_DIR=path.join(root,'boards');
const BOARDS_META=path.join(BOARDS_DIR,'boards.json');

function sendJSON(res,code,obj){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}
function readBody(req,limit,cb){
  let body='';
  req.on('data',c=>{body+=c;if(body.length>limit)req.destroy();});
  req.on('end',()=>cb(body));
}
function ensureBoards(){
  try{if(!fs.existsSync(BOARDS_DIR))fs.mkdirSync(BOARDS_DIR,{recursive:true});}catch(e){}
}
function readBoardsMeta(){
  try{const j=JSON.parse(fs.readFileSync(BOARDS_META,'utf8'));return Array.isArray(j.boards)?j.boards:[];}catch(e){return [];}
}
function writeBoardsMeta(list){
  ensureBoards();
  fs.writeFileSync(BOARDS_META,JSON.stringify({boards:list},null,2));
}

http.createServer((req,res)=>{
  const p0=decodeURIComponent(req.url.split('?')[0]);

  /* ---------- 事件数据 API：本地 events.json 持久化 ---------- */
  if(p0==='/api/events'){
    if(req.method==='GET'){
      fs.readFile(DATA_FILE,(err,buf)=>{
        if(err){sendJSON(res,200,{events:[]});return;}
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        res.end(buf);
      });
      return;
    }
    if(req.method==='POST'){
      let body='';
      // 25MB：事件可附加多张画布导出的 PNG 图片（base64 存储于 events.json）
      req.on('data',c=>{body+=c;if(body.length>25e6)req.destroy();});
      req.on('end',()=>{
        try{
          const j=JSON.parse(body||'{}');
          if(!j||!Array.isArray(j.events))throw new Error('bad payload');
          fs.writeFile(DATA_FILE,JSON.stringify(j,null,2),err=>{
            if(err){sendJSON(res,500,{ok:false,error:'write failed'});return;}
            sendJSON(res,200,{ok:true});
          });
        }catch(e){sendJSON(res,400,{ok:false,error:'bad payload'});}
      });
      return;
    }
    sendJSON(res,405,{ok:false,error:'method not allowed'});
    return;
  }

  /* ---------- 工作台画布 API：boards/ 目录持久化 ---------- */
  if(p0==='/api/boards'){
    if(req.method==='GET'){
      sendJSON(res,200,{boards:readBoardsMeta()});
      return;
    }
    if(req.method==='POST'){ // 新建画布 {name}
      readBody(req,1e6,body=>{
        try{
          const j=JSON.parse(body||'{}');
          const board={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),
            name:String(j.name||'未命名画布').slice(0,60),createdAt:Date.now(),updatedAt:Date.now()};
          const list=readBoardsMeta();list.unshift(board);writeBoardsMeta(list);
          sendJSON(res,200,{board});
        }catch(e){sendJSON(res,400,{ok:false,error:'bad payload'});}
      });
      return;
    }
    sendJSON(res,405,{ok:false,error:'method not allowed'});
    return;
  }
  const bm=p0.match(/^\/api\/boards\/([A-Za-z0-9_-]+)$/);
  if(bm){
    const id=bm[1];
    if(req.method==='GET'){ // 画布内容（Excalidraw 场景 JSON）
      let data='';
      try{data=fs.readFileSync(path.join(BOARDS_DIR,id+'.json'),'utf8')}catch(e){}
      sendJSON(res,200,{data});
      return;
    }
    if(req.method==='POST'){ // 保存画布 {data?, name?}
      readBody(req,5e7,body=>{
        try{
          const j=JSON.parse(body||'{}');
          if(typeof j.data==='string'){
            ensureBoards();
            fs.writeFileSync(path.join(BOARDS_DIR,id+'.json'),j.data);
          }
          if(typeof j.name==='string'){
            const list=readBoardsMeta();
            const b=list.find(x=>x.id===id);
            if(b){b.name=j.name.slice(0,60);b.updatedAt=Date.now();writeBoardsMeta(list);}
          }
          sendJSON(res,200,{ok:true});
        }catch(e){sendJSON(res,400,{ok:false,error:'bad payload'});}
      });
      return;
    }
    if(req.method==='DELETE'){
      try{fs.unlinkSync(path.join(BOARDS_DIR,id+'.json'))}catch(e){}
      try{fs.unlinkSync(path.join(BOARDS_DIR,id+'.xml'))}catch(e){} // 清理旧版残留
      writeBoardsMeta(readBoardsMeta().filter(x=>x.id!==id));
      sendJSON(res,200,{ok:true});
      return;
    }
    sendJSON(res,405,{ok:false,error:'method not allowed'});
    return;
  }

  /* ---------- 静态文件 ---------- */
  let p=p0;
  if(p==='/')p='/index.html';
  const f=path.join(root,p);
  if(!f.startsWith(root)||!fs.existsSync(f)){res.writeHead(404);res.end('404');return;}
  const ext=path.extname(f);
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'}[ext]||'application/octet-stream';
  // no-cache：保证页面改动后刷新即生效，避免浏览器缓存旧版 HTML
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache, no-store, must-revalidate'});
  fs.createReadStream(f).pipe(res);
}).listen(8799,()=>console.log('http://127.0.0.1:8799'));
