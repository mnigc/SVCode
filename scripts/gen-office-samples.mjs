// One-off: generate sample .xlsx/.docx/.pptx files for the UI-mock preview test.
// Run from project root: node scripts/gen-office-samples.mjs
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('public/uitest', { recursive: true })

/* ---- xlsx via SheetJS ---- */
const sales = [
  ['月份', '销售额', '成本', '利润'],
  ['1月', 128000, 86000, 42000],
  ['2月', 96500, 71000, 25500],
  ['3月', 152300, 98000, 54300],
  ['4月', 143800, 94500, 49300],
  ['合计', 520600, 349500, 171100],
]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sales), '销售数据')
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ['项目', '说明'],
    ['数据来源', '示例文件，用于预览测试'],
    ['更新时间', '2026-09-25'],
  ]),
  '备注',
)
XLSX.writeFile(wb, 'public/uitest/sample.xlsx')

/* ---- docx: minimal hand-built OOXML ---- */
const docx = new JSZip()
docx.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
)
docx.folder('_rels').file(
  '.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
)
docx.folder('word').file(
  'document.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>SVCode docx 预览测试</w:t></w:r></w:p>
<w:p><w:r><w:t>这是一段正文，用于验证 docx-preview 的渲染：标题、段落、表格与分页。</w:t></w:r></w:p>
<w:tbl>
<w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>
</w:tblBorders></w:tblPr>
<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr><w:tc><w:p><w:r><w:t>模块</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>状态</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>备注</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>docx 预览</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>进行中</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>docx-preview</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>xlsx 预览</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>进行中</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SheetJS</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>第二页</w:t></w:r></w:p>
<w:p><w:r><w:t>分页后的段落内容。</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body>
</w:document>`,
)
docx.folder('word').file(
  'styles.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
</w:styles>`,
)
docx.generateAsync({ type: 'nodebuffer' }).then((buf) => writeFileSync('public/uitest/sample.docx', buf))

/* ---- pptx: hand-built, only what the text extractor reads ---- */
const pptx = new JSZip()
const slide = (title, lines) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="1" name="标题"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="内容"/><p:nvPr/></p:nvSpPr>
<p:txBody><a:bodyPr/>${lines.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`
pptx.file('ppt/slides/slide1.xml', slide('第三季度工作汇报', ['业绩同比增长 23%', '新客户数量突破 400 家', '下一季度目标：海外市场']))
pptx.file('ppt/slides/slide2.xml', slide('技术方案', ['引入 docx-preview / SheetJS 渲染引擎', 'pptx 仅提取文本，保持包体轻量']))
pptx.generateAsync({ type: 'nodebuffer' }).then((buf) => writeFileSync('public/uitest/sample.pptx', buf))

/* ---- unsupported kinds for the card test ---- */
const misc = new JSZip()
misc.file('dummy.txt', 'placeholder archive for the unsupported-card UI test')
misc.generateAsync({ type: 'nodebuffer' }).then((buf) => writeFileSync('public/uitest/sample.zip', buf))
// legacy binary Word: extension-based kind detection, content never parsed
writeFileSync('public/uitest/sample.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 1, 0, 2]))
