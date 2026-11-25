'use strict';
/* Offline PDF generator. Hebrew text and worker photographs are rendered by
   the device's canvas, then embedded as JPEG image pages in a valid A4 PDF.
   No remote libraries or network access required. */
(() => {
  const W = 595.28, H = 841.89, SCALE = 2;
  const right = 565, left = 30;
  const tableTop = 175, tableBottom = 778;
  const col = {workerLeft: 340, dateLeft: 230, inLeft: 130};
  const groupHeight = 30, rowHeight = 46;
  const encoder = new TextEncoder();
  const asBytes = value => typeof value === 'string' ? encoder.encode(value) : value;
  const trimToWidth = (ctx, value, width) => {
    let s = String(value ?? '');
    if (ctx.measureText(s).width <= width) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > width) s = s.slice(0, -1);
    return s + '…';
  };
  const drawRTL = (ctx, text, x, y, size, color, weight = 400, maxWidth) => {
    ctx.save(); ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px Arial, sans-serif`; ctx.fillStyle = color;
    ctx.fillText(maxWidth ? trimToWidth(ctx, text, maxWidth) : text, x, y);
    ctx.restore();
  };
  const drawCenter = (ctx, value, x, y, size, color, weight = 400) => {
    ctx.save(); ctx.direction='ltr'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle=color; ctx.font=`${weight} ${size}px Arial, sans-serif`;
    ctx.fillText(value || '—', x, y); ctx.restore();
  };
  const niceDate = s => s ? s.split('-').reverse().join('.') : '';
  const imageCache = new Map();
  async function loadImage(src) {
    if (!src || typeof src !== 'string' || !src.startsWith('data:image/')) return null;
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, promise);
    return promise;
  }
  function drawAvatar(ctx, img, x, y, workerName) {
    ctx.save();
    ctx.fillStyle = '#e3f2ed'; ctx.beginPath(); if(typeof ctx.roundRect==='function')ctx.roundRect(x,y,31,31,8);else ctx.rect(x,y,31,31); ctx.fill();
    ctx.clip();
    if (img) {
      const size=Math.min(img.naturalWidth,img.naturalHeight);
      ctx.drawImage(img,(img.naturalWidth-size)/2,(img.naturalHeight-size)/2,size,size,x,y,31,31);
    } else {
      drawCenter(ctx,Array.from(workerName || '?')[0],x+15.5,y+16,16,'#19796e',700);
    }
    ctx.restore();
  }
  function newCanvas() {
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(W*SCALE); canvas.height=Math.round(H*SCALE);
    const ctx=canvas.getContext('2d',{alpha:false});
    if (!ctx) throw Error('Canvas is unavailable');
    ctx.scale(SCALE,SCALE); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
    return {canvas,ctx};
  }
  function drawPage(ctx,from,to,page,records) {
    ctx.fillStyle='#113842';ctx.fillRect(0,0,W,9);
    drawRTL(ctx,'דוח נוכחות פועלים',right,53,23,'#163944',700);
    drawRTL(ctx,`מתאריך ${niceDate(from)} עד ${niceDate(to)}`,right,83,12,'#577680',400);
    drawRTL(ctx,`${records} רישומי נוכחות`,right,112,10,'#577680',400);
    ctx.fillStyle='#eaf5f2';ctx.fillRect(left,140,right-left,34);
    drawRTL(ctx,'פועל ותמונה',right-13,157,11,'#215b55',700);
    drawCenter(ctx,'תאריך',(col.workerLeft+col.dateLeft)/2,157,11,'#215b55',700);
    drawCenter(ctx,'כניסה',(col.dateLeft+col.inLeft)/2,157,11,'#215b55',700);
    drawCenter(ctx,'יציאה',(col.inLeft+left)/2,157,11,'#215b55',700);
    ctx.fillStyle='#e4ecee';ctx.fillRect(left,tableTop-1,right-left,1);
    ctx.fillStyle='#e3eaec';ctx.fillRect(left,805,right-left,1);
    drawRTL(ctx,`עמוד ${page}`,right,821,9,'#7d979d');
    drawCenter(ctx,'Created by Mordi Ben Aderet',149,821,8,'#95a8ad');
  }
  function drawGroup(ctx,company,y,continued) {
    ctx.fillStyle='#eff6f4';ctx.fillRect(left,y,right-left,groupHeight);
    drawRTL(ctx,`חברת כוח אדם: ${company}${continued ? ' (המשך)' : ''}`,right-12,y+15,11,'#226b62',700,right-left-25);
  }
  function drawRecord(ctx,row,img,y,alternate) {
    ctx.fillStyle=alternate?'#f9fcfc':'#fff';ctx.fillRect(left,y,right-left,rowHeight);
    ctx.fillStyle='#e6eced';ctx.fillRect(left,y+rowHeight-1,right-left,1);
    drawAvatar(ctx,img,right-45,y+7,row.name);
    drawRTL(ctx,row.name,right-54,y+rowHeight/2,11.5,'#183b44',600,160);
    drawCenter(ctx,niceDate(row.date),(col.workerLeft+col.dateLeft)/2,y+rowHeight/2,10.8,'#365e68');
    drawCenter(ctx,row.start||'—',(col.dateLeft+col.inLeft)/2,y+rowHeight/2,11,'#20464e',600);
    drawCenter(ctx,row.end||'—',(col.inLeft+left)/2,y+rowHeight/2,11,'#20464e',600);
  }
  function canvasJpeg(canvas) {
    return new Promise((resolve,reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {reject(Error('JPEG conversion failed'));return;}
        try {resolve(new Uint8Array(await blob.arrayBuffer()));} catch(err){reject(err);}
      },'image/jpeg',0.81);
    });
  }
  function assemblePDF(pages) {
    const chunks=[];let size=0;
    const offsets=[0];
    function add(data){const bytes=asBytes(data);chunks.push(bytes);size+=bytes.length;}
    function object(num,fn){offsets[num]=size;add(`${num} 0 obj\n`);fn();add('\nendobj\n');}
    const count=2+pages.length*3;
    add('%PDF-1.4\n%PDF generated offline\n');
    object(1,()=>add('<< /Type /Catalog /Pages 2 0 R >>'));
    object(2,()=>add(`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${pages.length} >>`));
    pages.forEach((jpeg,i)=>{
      const pg=3+i*3, contents=pg+1, picture=pg+2;
      object(pg,()=>add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${picture} 0 R >> >> /Contents ${contents} 0 R >>`));
      const stream=`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
      object(contents,()=>{add(`<< /Length ${encoder.encode(stream).length} >>\nstream\n`);add(stream);add('endstream');});
      object(picture,()=>{add(`<< /Type /XObject /Subtype /Image /Width ${Math.round(W*SCALE)} /Height ${Math.round(H*SCALE)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);add(jpeg);add('\nendstream');});
    });
    const xref=size;
    add(`xref\n0 ${count+1}\n0000000000 65535 f \n`);
    for(let i=1;i<=count;i++)add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    add(`trailer\n<< /Size ${count+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks,{type:'application/pdf'});
  }
  async function exportReport(rows,{from,to}) {
    if (!rows.length) throw Error('No rows to export');
    imageCache.clear();
    const blobs=[];let pageNum=0,canvas,ctx,y,alternate=0;
    function beginPage(){({canvas,ctx}=newCanvas());pageNum++;drawPage(ctx,from,to,pageNum,rows.length);y=tableTop;}
    async function nextPage(){if(canvas)blobs.push(await canvasJpeg(canvas));beginPage();}
    await nextPage();
    let currentCompany=null;
    for(const row of rows){
      if(row.company!==currentCompany){
        currentCompany=row.company;
        if(y+groupHeight+rowHeight>tableBottom)await nextPage();
        drawGroup(ctx,currentCompany,y,false);y+=groupHeight;
      }
      if(y+rowHeight>tableBottom){await nextPage();drawGroup(ctx,currentCompany,y,true);y+=groupHeight;}
      const img=await loadImage(row.photo);
      drawRecord(ctx,row,img,y,alternate++%2===1);y+=rowHeight;
    }
    blobs.push(await canvasJpeg(canvas));
    const file=assemblePDF(blobs),url=URL.createObjectURL(file);
    const a=document.createElement('a');
    a.href=url;a.download=`worker-attendance-${from}-${to}.pdf`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    imageCache.clear();
    return {pages:blobs.length,bytes:file.size};
  }
  window.MordiPDF={export:exportReport};
})();
