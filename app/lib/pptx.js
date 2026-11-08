// Gera um arquivo .pptx (PowerPoint) simples no próprio navegador, sem biblioteca externa.
// slides: [{ label?, text }]; style: { font, size (pt), color, bg, caps, showLabel }
const enc = new TextEncoder();
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// ZIP sem compressão (método "stored"): suficiente e aceito pelo PowerPoint, ProPresenter e Holyrics
export function zipStore(files, mime = "application/zip") {
  const parts = [], central = []; let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of files) {
    const nb = enc.encode(name), db = typeof data === "string" ? enc.encode(data) : data, crc = crc32(db);
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)]);
    parts.push(head, nb, db);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += head.length + nb.length + db.length;
  }
  const csize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: mime });
}

const x = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const hex = (c, d = "000000") => (/^#?[0-9a-f]{6}$/i.test(c || "") ? c.replace("#", "").toUpperCase() : d);
const W = 12192000;
// proporção da tela de projeção ("16:9", "4:3", "16:10", "21:9" ou "1920x1080"); a largura é fixa e a altura acompanha
export const RATIOS = { "16:9": "16:9 (Full HD, padrão)", "16:10": "16:10", "4:3": "4:3 (telas antigas)", "21:9": "21:9 (telão largo)", "32:9": "32:9 (painel de LED largo)", "1:1": "1:1 (quadrado)" };
export function ratioOf(r) {
  const m = String(r || "16:9").match(/^(\d{2,5})\s*[x:×]\s*(\d{1,5})$/i) || String(r || "").match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  const a = m ? Number(m[1]) : 16, b = m ? Number(m[2]) : 9;
  return a > 0 && b > 0 && a / b >= 0.5 && a / b <= 6 ? [a, b] : [16, 9];
}
const hFor = (r) => { const [a, b] = ratioOf(r); return Math.round((W * b) / a / 2) * 2; };
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// transformações de maiúsculas/minúsculas ("upper", "lower", "title"); b.caps === true equivale a "upper"
export const applyCaps = (t, m) => { const mode = m === true ? "upper" : m; const v = String(t ?? ""); return mode === "upper" ? v.toUpperCase() : mode === "lower" ? v.toLowerCase() : mode === "title" ? v.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, c) => a + c.toUpperCase()) : v; };
const alphaXml = (a) => (a != null && a < 1 ? `<a:alpha val="${Math.round(Math.max(0, a) * 100000)}"/>` : "");
const pt = (v) => Math.round((v || 0) * 12700);
function boxXml(b, id, H, st) {
  const font = x(b.font || st.font || "Arial"), color = hex(b.color || st.color, "FFFFFF"), size = Math.round((b.size || st.size || 54) * 100);
  const algn = { l: "l", r: "r", ctr: "ctr", c: "ctr", just: "just" }[b.align] || "ctr", anchor = { t: "t", b: "b", ctr: "ctr", c: "ctr" }[b.anchor] || "ctr";
  const ta = (b.alpha ?? 1) * (b.opacity ?? 1);
  const tstroke = b.tstroke?.on ? `<a:ln w="${pt(b.tstroke.w || 2)}"><a:solidFill><a:srgbClr val="${hex(b.tstroke.color, "000000")}"/></a:solidFill></a:ln>` : "";
  const sh = b.shadow?.on ? `<a:effectLst><a:outerShdw blurRad="${pt(b.shadow.blur)}" dist="${pt(b.shadow.off)}" dir="${Math.round((((360 - (b.shadow.angle || 0)) % 360) + 360) % 360 * 60000)}" algn="ctr" rotWithShape="0"><a:srgbClr val="${hex(b.shadow.color, "000000")}">${alphaXml(b.shadow.op ?? 1)}</a:srgbClr></a:outerShdw></a:effectLst>` : "";
  const attrs = `lang="pt-BR" sz="${size}" b="${b.bold === false ? 0 : 1}"${b.italic ? ' i="1"' : ""}${b.underline ? ' u="sng"' : ""}${b.strike ? ' strike="sngStrike"' : ""} dirty="0"`;
  const paras = String(b.text || "").split("\n").map((l) => `<a:p><a:pPr algn="${algn}">${b.line && b.line !== 1 ? `<a:lnSpc><a:spcPct val="${Math.round(b.line * 100000)}"/></a:lnSpc>` : ""}</a:pPr><a:r><a:rPr ${attrs}>${tstroke}<a:solidFill><a:srgbClr val="${color}">${alphaXml(ta)}</a:srgbClr></a:solidFill>${sh}<a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t>${x(applyCaps(l, b.caps))}</a:t></a:r></a:p>`).join("");
  const X = Math.round(W * (b.x ?? 0.04)), Y = Math.round(H * (b.y ?? 0.06)), CX = Math.round(W * (b.w ?? 0.92)), CY = Math.round(H * (b.h ?? 0.88));
  const fill = b.fill?.on ? `<a:solidFill><a:srgbClr val="${hex(b.fill.color, "000000")}">${alphaXml(b.opacity ?? 1)}</a:srgbClr></a:solidFill>` : "<a:noFill/>";
  const ln = b.stroke?.on ? `<a:ln w="${pt(b.stroke.w || 2)}"><a:solidFill><a:srgbClr val="${hex(b.stroke.color, "FFFFFF")}">${alphaXml(b.opacity ?? 1)}</a:srgbClr></a:solidFill></a:ln>` : "";
  const rot = b.rot ? ` rot="${Math.round((((b.rot % 360) + 360) % 360) * 60000)}"` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Texto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${rot}><a:off x="${X}" y="${Y}"/><a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${ln}</p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
const TRANS = { fade: "<p:fade/>", push: '<p:push dir="u"/>', wipe: '<p:wipe dir="l"/>' };
const transXml = (t) => (TRANS[t] ? `<p:transition spd="med">${TRANS[t]}</p:transition>` : "");
function slideXml(s, st, H, imgRid) {
  const bgFill = imgRid ? `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${imgRid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>` : `<a:solidFill><a:srgbClr val="${hex(s.bg || st.bg, "000000")}"/></a:solidFill>`;
  if (s.boxes) {
    const dim = s.dim ? `<p:sp><p:nvSpPr><p:cNvPr id="90" name="Escurecer"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="${H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="000000"><a:alpha val="${Math.round(s.dim * 100000)}"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>` : "";
    return `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${bgFill}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${dim}${s.boxes.map((b, i) => boxXml(b, 2 + i, H, st)).join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transXml(s.trans)}</p:sld>`;
  }
  const font = x(st.font || "Arial"), color = hex(st.color, "FFFFFF"), size = Math.round((st.size || 54) * 100);
  const lines = String(s.text || "").split("\n");
  const paras = lines.map((l) => `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="pt-BR" sz="${size}" b="1" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t>${x(st.caps ? l.toUpperCase() : l)}</a:t></a:r></a:p>`).join("");
  const label = st.showLabel && s.label ? `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Parte"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="${W - 914400}" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
    <p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="pt-BR" sz="1800" dirty="0"><a:solidFill><a:srgbClr val="${color}"><a:alpha val="60000"/></a:srgbClr></a:solidFill><a:latin typeface="${font}"/></a:rPr><a:t>${x(st.caps ? s.label.toUpperCase() : s.label)}</a:t></a:r></a:p></p:txBody></p:sp>` : "";
  return `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${bgFill}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Letra"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="685800"/><a:ext cx="${W - 914400}" cy="${H - 1371600}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
    <p:txBody><a:bodyPr wrap="square" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>${label}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export function buildPptx(slides, style = {}) {
  const n = slides.length;
  const files = [
    ["[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`],
    ["ppt/presentation.xml", `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${hFor(style.ratio)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ["ppt/_rels/presentation.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`],
    ["ppt/slideMasters/slideMaster1.xml", `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(style.bg, "000000")}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`],
    ["ppt/slideMasters/_rels/slideMaster1.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`],
    ["ppt/slideLayouts/slideLayout1.xml", `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Em branco"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`],
    ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`],
    ["ppt/theme/theme1.xml", `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Somos"><a:themeElements><a:clrScheme name="Somos"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="3D8BFF"/></a:accent1><a:accent2><a:srgbClr val="5FCF9F"/></a:accent2><a:accent3><a:srgbClr val="E5B45A"/></a:accent3><a:accent4><a:srgbClr val="EF7B7B"/></a:accent4><a:accent5><a:srgbClr val="9B7BFF"/></a:accent5><a:accent6><a:srgbClr val="66666F"/></a:accent6><a:hlink><a:srgbClr val="3D8BFF"/></a:hlink><a:folHlink><a:srgbClr val="9B7BFF"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Somos"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Somos"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`],
    ...slides.flatMap((s, i) => [
      [`ppt/slides/slide${i + 1}.xml`, slideXml(s, s.style || style, hFor(style.ratio), s.bgImage ? "rId2" : null)],
      [`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${s.bgImage ? `<Relationship Id="rId2" Type="${REL}/image" Target="../media/image${i + 1}.${s.bgImage.ext}"/>` : ""}</Relationships>`],
      ...(s.bgImage ? [[`ppt/media/image${i + 1}.${s.bgImage.ext}`, s.bgImage.bytes]] : []),
    ]),
  ];
  return zipStore(files, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
}
