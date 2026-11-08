const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../dist/engine.js');

const products=`Handle,Title,Variant SKU,Variant Price,Variant Inventory Qty,Type
christmas-mug,Christmas Ceramic Mug,MUG-1,69,14,Drinkware
christmas-mug,,MUG-2,69,7,Drinkware
candle,Cloud Candle,CAN-1,89,3,Home fragrance`;
const orders=`Name,Created at,Lineitem name,Lineitem sku,Financial Status,Cancelled at
#1001,2026-11-01,Christmas Ceramic Mug,MUG-1,paid,
#1001,2026-11-01,Christmas Ceramic Mug,MUG-2,paid,
#1002,2026-11-02,Cloud Candle,CAN-1,paid,
#1003,2026-11-03,Cloud Candle,CAN-1,paid,
#1004,2026-11-04,Cloud Candle,CAN-1,paid,2026-11-04`;
const views=`Product handle,Product views,Date
christmas-mug,100,2026-11-01
candle,20,2026-11-01`;

test('parses quoted comma and escaped quotes',()=>{
  const x=engine.csv('Name,Title\n"#1","A, \"\"special\"\" mug"');
  assert.equal(x.data[0].title,'A, "special" mug');
});
test('rejects malformed rows and quotes',()=>{
  assert.throws(()=>engine.csv('a,b\n1,2,3'),/columns/);
  assert.throws(()=>engine.csv('a,b\n"unclosed,2'),/unclosed/);
});
test('validates required headers and numeric views',()=>{
  assert.ok(engine.validate('Name,Price\nA,5','views').errors.length);
  assert.ok(engine.validate('Product handle,Product views\na,NaN','views').errors.length);
});
test('joins variants and distinct orders, excludes cancellations',()=>{
  const report=engine.buildReport({products:engine.validate(products,'products'),orders:engine.validate(orders,'orders'),views:engine.validate(views,'views')});
  const mug=report.products.find(x=>x.id==='christmas-mug'),candle=report.products.find(x=>x.id==='candle');
  assert.equal(mug.stock,21);
  assert.equal(mug.orders,1);
  assert.equal(mug.views,100);
  assert.equal(mug.rate,1);
  assert.equal(candle.orders,2);
  assert.equal(candle.priority,'Low stock');
  assert.equal(report.storeRate,2.5);
});
test('does not invent missing conversion data',()=>{
  const report=engine.buildReport({products:engine.validate(products,'products'),orders:engine.validate(orders,'orders'),views:engine.validate('Product handle,Product views\nmissing,10','views')});
  assert.equal(report.storeRate,null);
  assert.ok(report.warnings.some(x=>x.includes('No matched product views')));
});
test('does not claim verified comparison without dated reports',()=>{
  assert.equal(engine.compare({rate:2,dateComplete:false},{rate:3,dateComplete:true}).verified,false);
});
test('evaluates a completed observation window without claiming causation',()=>{
  const p={name:'Christmas Ceramic Mug',handle:'christmas-mug',skus:['MUG-1'],rate:1};
  const o=engine.validate('Name,Created at,Lineitem sku\n#2001,2026-01-02,MUG-1\n#2002,2026-01-02,MUG-1','orders');
  const v=engine.validate('Product handle,Product views,Date\nchristmas-mug,100,2026-01-02','views');
  const x=engine.evaluateWindow(p,o,v,'2026-01-01');
  assert.equal(x.ready,true);
  assert.equal(x.rate,2);
  assert.equal(x.deltaPoints,1);
  assert.equal(x.verified,false);
});
