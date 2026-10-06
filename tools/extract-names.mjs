/* 사이트 index.html 의 var KO = {...}(한글 종목 이름)을 site/names-ko.json 으로 저장 — 텔레그램 문구의 '티커 (종목설명)'에 사용
   사용: node tools/extract-names.mjs <index.html 경로> <저장할 json 경로> */
import fs from "node:fs";
const [src, out] = process.argv.slice(2);
const s = fs.readFileSync(src, "utf8"), i = s.indexOf("var KO = {");
if (i < 0) { console.error("var KO 를 찾지 못함"); process.exit(1); }
let d = 0, j = s.indexOf("{", i), k = j;
for (; k < s.length; k++) { const c = s[k]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
const obj = new Function("return " + s.slice(j, k + 1))();
fs.writeFileSync(out, JSON.stringify(obj));
console.log("names-ko.json", Object.keys(obj).length + "개");
