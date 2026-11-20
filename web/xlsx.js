/* =====================================================================
   Generador mínimo de archivos .xlsx (Excel), sin dependencias.
   MiniXlsx.build([{ name:'Hoja', widths:[30,12], rows:[[celda, ...], ...] }]) → Uint8Array
   Celda: número (formato miles si es entero), texto, null (vacía) o { v, b:true } para negrita.
   ===================================================================== */
(function(root){
'use strict';
const enc = new TextEncoder();
const xml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';

function col(i){ let s=''; for(i=i+1; i>0; i=Math.floor((i-1)/26)) s=String.fromCharCode(65+(i-1)%26)+s; return s; }

// Estilos: 0 normal · 1 negrita · 2 número con separador de miles · 3 número en negrita
const STYLES = HEAD+`<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml(sh){
  const cols = (sh.widths||[]).map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
  const rows = (sh.rows||[]).map((row,r)=>{
    const cells = row.map((cell,c)=>{
      const o = (cell && typeof cell==='object') ? cell : {v:cell};
      if(o.v==null || o.v==='') return '';
      const ref = col(c)+(r+1);
      if(typeof o.v==='number' && isFinite(o.v)){ const s = Number.isInteger(o.v) ? (o.b?3:2) : (o.b?1:0); return `<c r="${ref}"${s?` s="${s}"`:''}><v>${o.v}</v></c>`; }
      return `<c r="${ref}" t="inlineStr"${o.b?' s="1"':''}><is><t xml:space="preserve">${xml(o.v)}</t></is></c>`;
    }).join('');
    return `<row r="${r+1}">${cells}</row>`;
  }).join('');
  return HEAD+`<worksheet xmlns="${NS}">${cols?`<cols>${cols}</cols>`:''}<sheetData>${rows}</sheetData></worksheet>`;
}

// ZIP sin compresión (método "store")
const CRC = (()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function zip(files){
  const parts=[], central=[]; let off=0;
  for(const f of files){
    const name=enc.encode(f.name), data=enc.encode(f.text), crc=crc32(data), n=data.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(12,0x21,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,n,true); lh.setUint32(22,n,true); lh.setUint16(26,name.length,true);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(14,0x21,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,n,true); ch.setUint32(24,n,true); ch.setUint16(28,name.length,true); ch.setUint32(42,off,true);
    parts.push(new Uint8Array(lh.buffer), name, data); central.push(new Uint8Array(ch.buffer), name);
    off += 30+name.length+n;
  }
  const cdSize=central.reduce((a,b)=>a+b.length,0);
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true); end.setUint32(12,cdSize,true); end.setUint32(16,off,true);
  const all=[...parts,...central,new Uint8Array(end.buffer)];
  const out=new Uint8Array(all.reduce((a,b)=>a+b.length,0)); let p=0; for(const a of all){ out.set(a,p); p+=a.length; }
  return out;
}

function build(sheets){
  const names = sheets.map((s,i)=>(String(s.name||'Hoja'+(i+1)).replace(/[\[\]:*?\/\\]/g,' ').slice(0,31))||'Hoja'+(i+1));
  const files = [
    {name:'[Content_Types].xml', text:HEAD+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}sheet.main+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="${CT}worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="${CT}styles+xml"/></Types>`},
    {name:'_rels/.rels', text:HEAD+`<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:'xl/workbook.xml', text:HEAD+`<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${names.map((n,i)=>`<sheet name="${xml(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`},
    {name:'xl/_rels/workbook.xml.rels', text:HEAD+`<Relationships xmlns="${PKG}">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml', text:STYLES},
    ...sheets.map((s,i)=>({name:`xl/worksheets/sheet${i+1}.xml`, text:sheetXml(s)})),
  ];
  return zip(files);
}

const api = { build, MIME:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
if(typeof module!=='undefined' && module.exports) module.exports = api; else root.MiniXlsx = api;
})(typeof window!=='undefined' ? window : globalThis);
