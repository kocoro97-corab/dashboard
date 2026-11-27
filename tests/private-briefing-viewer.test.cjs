'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const viewer=require('../js/private-briefing-viewer.js');
test('parses supplied display structures without retaining executable attributes or original mutations',()=>{
 const source='# 제목\n<grid columns={2}><box><title>요약</title>**강조**<Cite refs={["internal"]}/></box></grid>';
 const before=source;const tree=viewer.parse(source);
 assert.equal(source,before);assert.equal(tree.children[1].tag,'grid');
 assert.ok(JSON.stringify(tree).includes('〔인용〕'));assert.ok(!JSON.stringify(tree).includes('internal'));
});
test('script, resource and form elements never enter the viewer AST',()=>{
 const tree=viewer.parse('<script>PRIVATE_SCRIPT</script><iframe src="https://forbidden.invalid"></iframe><img src="https://forbidden.invalid"><p onclick="alert(1)">유지할 문장</p>');
 assert.ok(!JSON.stringify(tree).includes('PRIVATE_SCRIPT'));assert.deepEqual(tree.children.map(x=>x.tag),['p']);
});
test('links reject executable schemes, credentials and entity-encoded payloads',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,code','https://user:password@example.test','/relative'])assert.equal(viewer.safeUrl(url),null);
 assert.equal(viewer.safeUrl('https://example.test/report'),'https://example.test/report');
 const tree=viewer.parse('| 항목 | 내용 |\n| --- | --- |\n| 자료 | <Link url="https://example.test">공식 자료</Link><Cite ref="internal"/> |');
 assert.equal(tree.children.length,1,'inline component tags must not split markdown table rows');
 assert.ok(tree.children[0].includes('[공식 자료](https://example.test/)〔인용〕'));
});
test('deep or oversized content is bounded before rendering',()=>{
 assert.throws(()=>viewer.parse('x'.repeat(280001)));
 assert.throws(()=>viewer.parse('<box>'.repeat(40)));
});
